"use server";

import { createEmailClient } from "@/lib/adapters/email";
import {
  createSeatAssignerClient,
  suggestWithFallback,
} from "@/lib/adapters/ai/seat-assigner";
import { applyReceiptUploadForOrder } from "@/lib/order/apply-receipt-upload";
import { mapDbSeat } from "@/lib/order/map-seat";
import { buildSeatCandidates, reasonLineForPick } from "@/lib/rules/seat-assigner";
import {
  quotePrice,
  type DiscountCard,
  type Promo,
} from "@/lib/rules/price";
import type { PaymentTiming } from "@/lib/rules/orders";
import { canHold, type SaleScope } from "@/lib/rules/seats";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type QuoteState =
  | {
      ok: true;
      totalCentavos: number;
      cardRebateCentavos: number;
      applied: string;
      pricePerSeatCentavos: number;
    }
  | { ok: false; reason: string };

export type SuggestionOption = {
  id: string;
  seatIds: string[];
  labels: string[];
  reason: string;
  totalCentavos: number;
  pricePerSeatCentavos: number;
  cardRebateCentavos: number;
};

export type SubmitState =
  | {
      ok: true;
      orderId: string;
      receiptToken: string;
      paymentTiming: PaymentTiming;
      paymentSubmitted: boolean;
    }
  | {
      ok: false;
      reason: string;
      suggestions?: SuggestionOption[];
      hasUncheckableRequest?: boolean;
    };

function parsePaymentTiming(value: FormDataEntryValue | null): PaymentTiming | null {
  if (value === "now" || value === "later") return value;
  return null;
}

function pesos(centavos: number): string {
  return (centavos / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function manilaDeadline(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function parseDiscountCard(value: FormDataEntryValue | null): DiscountCard {
  if (value === "pwd" || value === "senior" || value === "none") return value;
  return "none";
}

function quoteJson(quote: Extract<ReturnType<typeof quotePrice>, { ok: true }>) {
  return {
    tickets: quote.tickets,
    totalCentavos: quote.totalCentavos,
    appliedDiscount: quote.applied,
    cardRebateCentavos: quote.cardRebateCentavos,
  };
}

async function loadOrderContext(showbuyId: string) {
  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name, event_url, orders_paused, coverage")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) return null;

  const [{ data: sections }, { data: seats }, { data: promos }, { data: payments }] =
    await Promise.all([
      supabase
        .from("sections")
        .select("id, name, regular_price_centavos, is_for_sale")
        .eq("showbuy_id", showbuyId)
        .order("name"),
      supabase
        .from("seats")
        .select(
          "id, showbuy_id, section_id, row_label, seat_number, grid_row, position, status, t2m_status, conflict",
        )
        .eq("showbuy_id", showbuyId),
      supabase
        .from("promos")
        .select(
          "id, code, active, price_centavos_by_section, usage_limit, requires_single_seat",
        )
        .eq("showbuy_id", showbuyId),
      supabase
        .from("payment_accounts")
        .select("id, platform, account_name, account_number")
        .eq("showbuy_id", showbuyId),
    ]);

  const mappedSeats = (seats ?? []).map(mapDbSeat);
  const forSaleIds = (sections ?? [])
    .filter((section) => section.is_for_sale !== false)
    .map((section) => section.id);
  const scope: SaleScope = {
    coverage: showbuy.coverage === "partial" ? "partial" : "full",
    sectionIds: forSaleIds,
  };

  return {
    supabase,
    showbuy,
    sections: sections ?? [],
    seats: mappedSeats,
    promos: promos ?? [],
    payments: payments ?? [],
    scope,
  };
}

function promoFromRow(
  row: {
    code: string;
    active: boolean;
    price_centavos_by_section: Record<string, number> | null;
    usage_limit: number | null;
    requires_single_seat: boolean;
  } | null,
): Promo | null {
  if (!row) return null;
  return {
    code: row.code,
    active: row.active,
    priceCentavosBySection: row.price_centavos_by_section ?? {},
    usageLimit: row.usage_limit,
    requiresSingleSeat: row.requires_single_seat,
  };
}

export async function previewQuote(
  showbuyId: string,
  formData: FormData,
): Promise<QuoteState> {
  const ctx = await loadOrderContext(showbuyId);
  if (!ctx) return { ok: false, reason: "showbuy_not_found" };

  const seatIds = formData.getAll("seatId").map(String);
  const discountCard = parseDiscountCard(formData.get("discountCard"));
  const enteredCode = String(formData.get("promoCode") ?? "").trim() || null;

  const chosen = seatIds
    .map((id) => ctx.seats.find((seat) => seat.id === id))
    .filter((seat): seat is NonNullable<typeof seat> => seat !== undefined);

  if (chosen.length !== seatIds.length || chosen.length === 0) {
    return { ok: false, reason: "invalid_seats" };
  }

  const sectionPrices = Object.fromEntries(
    ctx.sections.map((section) => [section.id, section.regular_price_centavos]),
  );
  const promoRow =
    enteredCode === null
      ? null
      : (ctx.promos.find(
          (promo) => promo.code.trim().toLowerCase() === enteredCode.toLowerCase(),
        ) ?? null);

  const { count: promoUses } = await ctx.supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", showbuyId)
    .eq("applied_discount", "promo")
    .neq("status", "cancelled");

  const quote = quotePrice({
    seats: chosen.map((seat) => ({
      sectionId: seat.sectionId,
      regularPriceCentavos: sectionPrices[seat.sectionId] ?? 0,
    })),
    promo: promoFromRow(promoRow),
    enteredCode,
    discountCard,
    promoUses: promoUses ?? 0,
    browserTotalCentavos: Number(formData.get("browserTotal") ?? NaN),
  });

  if (!quote.ok) return { ok: false, reason: quote.reason };
  return {
    ok: true,
    totalCentavos: quote.totalCentavos,
    cardRebateCentavos: quote.cardRebateCentavos,
    applied: quote.applied,
    pricePerSeatCentavos: quote.tickets[0]?.pricePerSeatCentavos ?? 0,
  };
}

function sectionIdsWithSameName(
  sections: {
    id: string;
    name: string;
    is_for_sale: boolean | null;
  }[],
  preferredSectionId: string,
): string[] {
  const preferred = sections.find((section) => section.id === preferredSectionId);
  if (!preferred || preferred.is_for_sale === false) return [preferredSectionId];
  const key = preferred.name.trim().toLowerCase();
  return sections
    .filter(
      (section) =>
        section.is_for_sale !== false && section.name.trim().toLowerCase() === key,
    )
    .map((section) => section.id);
}

async function buildSuggestions(input: {
  ctx: NonNullable<Awaited<ReturnType<typeof loadOrderContext>>>;
  preferredSectionId: string;
  qty: number;
  firstChoice: string[];
  note: string;
  discountCard: DiscountCard;
  enteredCode: string | null;
  requiresSingle: boolean;
}): Promise<{ suggestions: SuggestionOption[]; hasUncheckableRequest: boolean }> {
  const candidates = buildSeatCandidates({
    seats: input.ctx.seats,
    preferredSectionId: input.preferredSectionId,
    preferredSectionIds: sectionIdsWithSameName(
      input.ctx.sections,
      input.preferredSectionId,
    ),
    qty: input.qty,
    firstChoiceSeatIds: input.firstChoice,
    requiresSingle: input.requiresSingle,
    scope: input.ctx.scope,
  });

  const assigner = createSeatAssignerClient();
  const picks = await suggestWithFallback(assigner, {
    note: input.note.slice(0, 200),
    candidates,
  });

  const sectionPrices = Object.fromEntries(
    input.ctx.sections.map((section) => [section.id, section.regular_price_centavos]),
  );
  const promoRow =
    input.enteredCode === null
      ? null
      : (input.ctx.promos.find(
          (promo) =>
            promo.code.trim().toLowerCase() === input.enteredCode!.toLowerCase(),
        ) ?? null);

  const { count: promoUses } = await input.ctx.supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", input.ctx.showbuy.id)
    .eq("applied_discount", "promo")
    .neq("status", "cancelled");

  const suggestions: SuggestionOption[] = [];
  for (const pick of picks.picks) {
    const candidate = candidates.find((item) => item.id === pick.id);
    if (!candidate) continue;
    const chosen = candidate.seatIds
      .map((id) => input.ctx.seats.find((seat) => seat.id === id))
      .filter((seat): seat is NonNullable<typeof seat> => seat !== undefined);
    if (chosen.length !== candidate.seatIds.length) continue;

    const quote = quotePrice({
      seats: chosen.map((seat) => ({
        sectionId: seat.sectionId,
        regularPriceCentavos: sectionPrices[seat.sectionId] ?? 0,
      })),
      promo: promoFromRow(promoRow),
      enteredCode: input.enteredCode,
      discountCard: input.discountCard,
      promoUses: promoUses ?? 0,
    });
    if (!quote.ok) continue;

    suggestions.push({
      id: candidate.id,
      seatIds: candidate.seatIds,
      labels: chosen.map((seat) => seat.label),
      reason: reasonLineForPick(pick, candidates),
      totalCentavos: quote.totalCentavos,
      pricePerSeatCentavos: quote.tickets[0]?.pricePerSeatCentavos ?? 0,
      cardRebateCentavos: quote.cardRebateCentavos,
    });
  }

  return {
    suggestions,
    hasUncheckableRequest: picks.hasUncheckableRequest,
  };
}

async function finalizeHeldOrder(input: {
  ctx: NonNullable<Awaited<ReturnType<typeof loadOrderContext>>>;
  showbuyId: string;
  order: {
    id: string;
    receipt_token: string;
    hold_expires_at: string;
    total_centavos: number;
    card_rebate_centavos: number;
    qty: number;
  };
  sectionName: string;
  email: string;
  paymentAccountId: string;
  paymentTiming: PaymentTiming;
  receiptFile: FormDataEntryValue | null;
}): Promise<SubmitState> {
  const {
    ctx,
    showbuyId,
    order,
    sectionName,
    email,
    paymentAccountId,
    paymentTiming,
    receiptFile,
  } = input;

  await ctx.supabase
    .from("orders")
    .update({ payment_timing: paymentTiming })
    .eq("id", order.id);

  if (paymentTiming === "now") {
    if (!(receiptFile instanceof File) || receiptFile.size === 0) {
      return { ok: false, reason: "missing_receipt" };
    }
    const uploaded = await applyReceiptUploadForOrder({
      supabase: ctx.supabase,
      orderId: order.id,
      file: receiptFile,
    });
    if (!uploaded.ok) {
      return { ok: false, reason: uploaded.reason };
    }
    return {
      ok: true,
      orderId: order.id,
      receiptToken: order.receipt_token,
      paymentTiming,
      paymentSubmitted: true,
    };
  }

  const payment =
    ctx.payments.find((item) => item.id === paymentAccountId) ?? ctx.payments[0]!;
  const emailClient = createEmailClient();
  const sent = await emailClient.sendPaymentInfo({
    to: email,
    orderId: order.id,
    showbuyId,
    orderNumber: order.id.slice(0, 8),
    quantity: order.qty,
    sectionName,
    totalPesos: pesos(order.total_centavos),
    paymentLines: [
      `${payment.platform} · ${payment.account_name} · ${payment.account_number}`,
    ],
    deadlineManila: manilaDeadline(order.hold_expires_at),
    receiptPath: `/receipt/${order.receipt_token}`,
    rebatePesos:
      order.card_rebate_centavos > 0 ? pesos(order.card_rebate_centavos) : null,
  });

  if (!sent.ok) {
    await ctx.supabase
      .from("orders")
      .update({
        status: "process_manually",
        manual_reason: "payment_email_failed",
      })
      .eq("id", order.id);
  } else {
    await ctx.supabase
      .from("orders")
      .update({ payment_email_sent_at: new Date().toISOString() })
      .eq("id", order.id);
  }

  return {
    ok: true,
    orderId: order.id,
    receiptToken: order.receipt_token,
    paymentTiming,
    paymentSubmitted: false,
  };
}

export async function submitOrder(
  showbuyId: string,
  _prev: SubmitState | null,
  formData: FormData,
): Promise<SubmitState> {
  const ctx = await loadOrderContext(showbuyId);
  if (!ctx) return { ok: false, reason: "showbuy_not_found" };
  if (ctx.showbuy.orders_paused) {
    return { ok: false, reason: "orders_paused" };
  }
  if (ctx.payments.length === 0) {
    return { ok: false, reason: "no_payment_account" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const mobile = String(formData.get("mobile") ?? "").trim();
  const preferredSectionId = String(formData.get("preferredSectionId") ?? "");
  const qty = Number(formData.get("qty") ?? 0);
  const firstChoice = formData.getAll("firstChoice").map(String);
  const secondChoice = formData.getAll("secondChoice").map(String);
  const paymentAccountId = String(
    formData.get("paymentAccountId") ?? ctx.payments[0]!.id,
  );
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const enteredCode = String(formData.get("promoCode") ?? "").trim() || null;
  const discountCard = parseDiscountCard(formData.get("discountCard"));
  const note = String(formData.get("note") ?? "").slice(0, 200);
  const paymentTiming = parsePaymentTiming(formData.get("paymentTiming"));
  const receiptFile = formData.get("receipt");

  if (!name || !email || !mobile) return { ok: false, reason: "missing_contact" };
  if (!paymentTiming) return { ok: false, reason: "missing_payment_timing" };
  if (paymentTiming === "now" && (!(receiptFile instanceof File) || receiptFile.size === 0)) {
    return { ok: false, reason: "missing_receipt" };
  }
  if (!idempotencyKey) return { ok: false, reason: "missing_idempotency_key" };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "invalid_qty" };
  if (firstChoice.length === 0) {
    return { ok: false, reason: "missing_first_choice" };
  }
  if (firstChoice.length !== qty) {
    return { ok: false, reason: "incomplete_first_choice" };
  }
  if (secondChoice.length === 0) {
    return { ok: false, reason: "missing_second_choice" };
  }
  if (secondChoice.length !== qty) {
    return { ok: false, reason: "incomplete_second_choice" };
  }

  const section = ctx.sections.find((item) => item.id === preferredSectionId);
  if (!section || section.is_for_sale === false) {
    return { ok: false, reason: "invalid_section" };
  }

  for (const id of [...firstChoice, ...secondChoice]) {
    const seat = ctx.seats.find((item) => item.id === id);
    if (!seat) return { ok: false, reason: "invalid_seats" };
    if (seat.status === "available_t2m") {
      return { ok: false, reason: "use_ticket2me_link" };
    }
    if (!canHold(seat, ctx.scope) && seat.status !== "on_hold") {
      // on_hold may still be second-choice attempt; SQL decides
    }
  }

  const sectionPrices = Object.fromEntries(
    ctx.sections.map((item) => [item.id, item.regular_price_centavos]),
  );
  const promoRow =
    enteredCode === null
      ? null
      : (ctx.promos.find(
          (promo) => promo.code.trim().toLowerCase() === enteredCode.toLowerCase(),
        ) ?? null);
  const requiresSingle = Boolean(promoRow?.requires_single_seat);

  const { count: promoUses } = await ctx.supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", showbuyId)
    .eq("applied_discount", "promo")
    .neq("status", "cancelled");

  function quoteFor(ids: string[]) {
    const chosen = ids.map((id) => ctx!.seats.find((seat) => seat.id === id)!);
    return quotePrice({
      seats: chosen.map((seat) => ({
        sectionId: seat.sectionId,
        regularPriceCentavos: sectionPrices[seat.sectionId] ?? 0,
      })),
      promo: promoFromRow(promoRow),
      enteredCode,
      discountCard,
      promoUses: promoUses ?? 0,
    });
  }

  const firstQuote = quoteFor(firstChoice);
  const secondQuote = quoteFor(secondChoice);
  if (!firstQuote.ok) return { ok: false, reason: firstQuote.reason };
  if (!secondQuote.ok) return { ok: false, reason: secondQuote.reason };

  const { data: orderId, error } = await ctx.supabase.rpc("hold_seats", {
    p_showbuy_id: showbuyId,
    p_idempotency_key: idempotencyKey,
    p_name: name,
    p_email: email,
    p_mobile: mobile,
    p_preferred_section_id: preferredSectionId,
    p_qty: qty,
    p_first_choice: firstChoice,
    p_second_choice: secondChoice,
    p_first_quote: quoteJson(firstQuote),
    p_second_quote: quoteJson(secondQuote),
    p_promo_code: enteredCode,
    p_discount_card: discountCard,
    p_payment_account_id: paymentAccountId,
    p_suggested_choice: null,
    p_suggested_quote: null,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("neither choice available")) {
      const { suggestions, hasUncheckableRequest } = await buildSuggestions({
        ctx,
        preferredSectionId,
        qty,
        firstChoice,
        note,
        discountCard,
        enteredCode,
        requiresSingle,
      });
      if (suggestions.length === 0) {
        return { ok: false, reason: "no_suggestions", hasUncheckableRequest };
      }
      return {
        ok: false,
        reason: "suggestions",
        suggestions,
        hasUncheckableRequest,
      };
    }
    return { ok: false, reason: message || "hold_failed" };
  }

  const { data: order } = await ctx.supabase
    .from("orders")
    .select("id, receipt_token, hold_expires_at, total_centavos, card_rebate_centavos, qty")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, reason: "order_missing_after_hold" };

  return finalizeHeldOrder({
    ctx,
    showbuyId,
    order,
    sectionName: section.name,
    email,
    paymentAccountId,
    paymentTiming,
    receiptFile: paymentTiming === "now" ? receiptFile : null,
  });
}

export async function confirmSuggestion(
  showbuyId: string,
  _prev: SubmitState | null,
  formData: FormData,
): Promise<SubmitState> {
  const ctx = await loadOrderContext(showbuyId);
  if (!ctx) return { ok: false, reason: "showbuy_not_found" };

  const suggestedIds = formData.getAll("suggestedSeatId").map(String);
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const mobile = String(formData.get("mobile") ?? "").trim();
  const preferredSectionId = String(formData.get("preferredSectionId") ?? "");
  const qty = Number(formData.get("qty") ?? 0);
  const paymentAccountId = String(
    formData.get("paymentAccountId") ?? ctx.payments[0]?.id ?? "",
  );
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();
  const enteredCode = String(formData.get("promoCode") ?? "").trim() || null;
  const discountCard = parseDiscountCard(formData.get("discountCard"));
  const firstChoice = formData.getAll("firstChoice").map(String);
  const secondChoice = formData.getAll("secondChoice").map(String);
  const paymentTiming = parsePaymentTiming(formData.get("paymentTiming"));
  const receiptFile = formData.get("receipt");

  if (!paymentTiming) return { ok: false, reason: "missing_payment_timing" };
  if (paymentTiming === "now" && (!(receiptFile instanceof File) || receiptFile.size === 0)) {
    return { ok: false, reason: "missing_receipt" };
  }
  if (suggestedIds.length !== qty || qty < 1) {
    return { ok: false, reason: "invalid_suggestion" };
  }

  const sectionPrices = Object.fromEntries(
    ctx.sections.map((item) => [item.id, item.regular_price_centavos]),
  );
  const promoRow =
    enteredCode === null
      ? null
      : (ctx.promos.find(
          (promo) => promo.code.trim().toLowerCase() === enteredCode.toLowerCase(),
        ) ?? null);

  const { count: promoUses } = await ctx.supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", showbuyId)
    .eq("applied_discount", "promo")
    .neq("status", "cancelled");

  const chosen = suggestedIds.map((id) => ctx.seats.find((seat) => seat.id === id));
  if (chosen.some((seat) => !seat || !canHold(seat, ctx.scope))) {
    const note = String(formData.get("note") ?? "").slice(0, 200);
    const { suggestions, hasUncheckableRequest } = await buildSuggestions({
      ctx,
      preferredSectionId,
      qty,
      firstChoice,
      note,
      discountCard,
      enteredCode,
      requiresSingle: Boolean(promoRow?.requires_single_seat),
    });
    return {
      ok: false,
      reason: "suggestions",
      suggestions,
      hasUncheckableRequest,
    };
  }

  const quote = quotePrice({
    seats: chosen.map((seat) => ({
      sectionId: seat!.sectionId,
      regularPriceCentavos: sectionPrices[seat!.sectionId] ?? 0,
    })),
    promo: promoFromRow(promoRow),
    enteredCode,
    discountCard,
    promoUses: promoUses ?? 0,
  });
  if (!quote.ok) return { ok: false, reason: quote.reason };

  const emptyQuote = {
    tickets: quote.tickets,
    totalCentavos: quote.totalCentavos,
    appliedDiscount: quote.applied,
    cardRebateCentavos: quote.cardRebateCentavos,
  };

  const { data: orderId, error } = await ctx.supabase.rpc("hold_seats", {
    p_showbuy_id: showbuyId,
    p_idempotency_key: idempotencyKey,
    p_name: name,
    p_email: email,
    p_mobile: mobile,
    p_preferred_section_id: preferredSectionId,
    p_qty: qty,
    p_first_choice: firstChoice.length === qty ? firstChoice : suggestedIds,
    p_second_choice: secondChoice.length === qty ? secondChoice : suggestedIds,
    p_first_quote: emptyQuote,
    p_second_quote: emptyQuote,
    p_promo_code: enteredCode,
    p_discount_card: discountCard,
    p_payment_account_id: paymentAccountId,
    p_suggested_choice: suggestedIds,
    p_suggested_quote: emptyQuote,
  });

  if (error) {
    return { ok: false, reason: error.message || "suggested_hold_failed" };
  }

  const { data: order } = await ctx.supabase
    .from("orders")
    .select("id, receipt_token, hold_expires_at, total_centavos, card_rebate_centavos, qty")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, reason: "order_missing_after_hold" };

  const section = ctx.sections.find((item) => item.id === preferredSectionId);
  return finalizeHeldOrder({
    ctx,
    showbuyId,
    order,
    sectionName: section?.name ?? "Section",
    email,
    paymentAccountId,
    paymentTiming,
    receiptFile: paymentTiming === "now" ? receiptFile : null,
  });
}
