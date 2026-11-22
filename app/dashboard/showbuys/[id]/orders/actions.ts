"use server";

import { revalidatePath } from "next/cache";
import { createEmailClient } from "@/lib/adapters/email";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import {
  abbreviateSectionCode,
  claimDiscountCode,
  formatClaimCode,
  formatClaimOrderId,
  validateClaimCodeTemplate,
} from "@/lib/rules/claim-code";
import {
  applyProcessResult,
  cancelOrder,
  canTransition,
  confirmPayment,
  planProcessOrders,
  rejectReceipt,
  type OrderStatus,
} from "@/lib/rules/orders";
import { mapDbOrder } from "@/lib/order/map-order";
import { mapDbSeat } from "@/lib/order/map-seat";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ActionState =
  | { ok: true; message: string }
  | { ok: false; reason: string };

const ORDER_SELECT =
  "id, showbuy_id, name, email, mobile, status, hold_expires_at, payment_confirmed_at, payment_email_sent_at, claim_email_sent_at, claim_code, held_seat_ids, suggested_choice_seat_ids, applied_discount, discount_card, manual_reason, total_centavos, card_rebate_centavos, qty, preferred_section_id, payment_account_id, receipt_token, tickets";

async function loadOrderBundle(showbuyId: string, orderId: string) {
  const supabase = createSupabaseServiceClient();
  const { data: orderRow } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", orderId)
    .eq("showbuy_id", showbuyId)
    .maybeSingle();
  if (!orderRow) return null;

  const { data: seatRows } = await supabase
    .from("seats")
    .select(
      "id, showbuy_id, section_id, row_label, seat_number, grid_row, position, status, t2m_status, conflict",
    )
    .eq("showbuy_id", showbuyId)
    .in("id", orderRow.held_seat_ids.length ? orderRow.held_seat_ids : ["00000000-0000-0000-0000-000000000000"]);

  return {
    supabase,
    orderRow,
    order: mapDbOrder(orderRow, Date.now()),
    seats: (seatRows ?? []).map(mapDbSeat),
  };
}

export async function setOrderStatus(
  showbuyId: string,
  orderId: string,
  to: OrderStatus,
): Promise<ActionState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const bundle = await loadOrderBundle(showbuyId, orderId);
  if (!bundle) return { ok: false, reason: "not_found" };

  if (to === "paid") {
    const result = confirmPayment(
      bundle.order,
      bundle.seats,
      "showbuyer",
      new Date().toISOString(),
    );
    if (!result.ok) return { ok: false, reason: "transition_denied" };

    const { error: orderError } = await bundle.supabase
      .from("orders")
      .update({
        status: "paid",
        payment_confirmed_at: result.order.paymentConfirmedAt,
      })
      .eq("id", orderId);
    if (orderError) return { ok: false, reason: "order_update_failed" };

    for (const seat of result.seats.filter((s) => result.order.heldSeatIds.includes(s.id))) {
      await bundle.supabase
        .from("seats")
        .update({ status: seat.status, conflict: seat.conflict, active_order_id: null })
        .eq("id", seat.id);
    }

    revalidatePath(`/dashboard/showbuys/${showbuyId}/orders`);
    return { ok: true, message: "Marked paid." };
  }

  if (to === "cancelled") {
    const result = cancelOrder(bundle.order, bundle.seats);
    if (!result.ok) return { ok: false, reason: "transition_denied" };

    const { error: orderError } = await bundle.supabase
      .from("orders")
      .update({ status: "cancelled", held_seat_ids: [] })
      .eq("id", orderId);
    if (orderError) return { ok: false, reason: "order_update_failed" };

    for (const seat of result.seats.filter((s) => bundle.order.heldSeatIds.includes(s.id))) {
      await bundle.supabase
        .from("seats")
        .update({
          status: seat.status,
          conflict: seat.conflict,
          active_order_id: null,
        })
        .eq("id", seat.id);
    }

    revalidatePath(`/dashboard/showbuys/${showbuyId}/orders`);
    return { ok: true, message: "Order cancelled." };
  }

  if (to === "sent_payment_info" && bundle.order.status === "payment_submitted") {
    const next = rejectReceipt(bundle.order);
    const { error } = await bundle.supabase
      .from("orders")
      .update({ status: next.status })
      .eq("id", orderId);
    if (error) return { ok: false, reason: "order_update_failed" };
    revalidatePath(`/dashboard/showbuys/${showbuyId}/orders`);
    return { ok: true, message: "Receipt rejected." };
  }

  if (!canTransition(bundle.order, to, "showbuyer")) {
    return { ok: false, reason: "transition_denied" };
  }

  const patch: Record<string, string | null> = { status: to };
  if (to === "process_manually") patch.manual_reason = "showbuyer";
  const { error } = await bundle.supabase.from("orders").update(patch).eq("id", orderId);
  if (error) return { ok: false, reason: "order_update_failed" };

  revalidatePath(`/dashboard/showbuys/${showbuyId}/orders`);
  return { ok: true, message: `Status set to ${to}.` };
}

export async function processOrders(showbuyId: string): Promise<ActionState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name, claim_code_template")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) return { ok: false, reason: "showbuy_not_found" };

  const templateCheck = validateClaimCodeTemplate(showbuy.claim_code_template);
  if (!templateCheck.ok) return { ok: false, reason: templateCheck.reason };

  const { data: orderRows } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("showbuy_id", showbuyId)
    .in("status", ["sent_payment_info", "paid"]);

  const nowMs = Date.now();
  const orders = (orderRows ?? []).map((row) => mapDbOrder(row, nowMs));
  const seatsByOrderId: Record<string, ReturnType<typeof mapDbSeat>[]> = {};

  for (const row of orderRows ?? []) {
    if (!row.held_seat_ids.length) {
      seatsByOrderId[row.id] = [];
      continue;
    }
    const { data: seats } = await supabase
      .from("seats")
      .select(
        "id, showbuy_id, section_id, row_label, seat_number, grid_row, position, status, t2m_status, conflict",
      )
      .in("id", row.held_seat_ids);
    seatsByOrderId[row.id] = (seats ?? []).map(mapDbSeat);
  }

  const tasks = planProcessOrders(orders, seatsByOrderId);
  if (tasks.length === 0) {
    return { ok: true, message: "Nothing to process." };
  }

  const email = createEmailClient();
  const { data: sections } = await supabase
    .from("sections")
    .select("id, name")
    .eq("showbuy_id", showbuyId);
  const sectionNameById = Object.fromEntries(
    (sections ?? []).map((section) => [section.id, section.name]),
  );

  let sent = 0;
  let failed = 0;

  for (const task of tasks) {
    const row = orderRows!.find((item) => item.id === task.orderId)!;
    const order = mapDbOrder(row, Date.now());
    const seats = seatsByOrderId[task.orderId] ?? [];
    const sectionName = sectionNameById[row.preferred_section_id] ?? "Section";
    const orderNumber = row.id.slice(0, 8);
    const at = new Date().toISOString();

    if (task.task === "payment_details") {
      const { data: payment } = await supabase
        .from("payment_accounts")
        .select("platform, account_name, account_number")
        .eq("id", row.payment_account_id)
        .maybeSingle();

      const deadline = row.hold_expires_at
        ? new Date(row.hold_expires_at).toLocaleString("en-PH", {
            timeZone: "Asia/Manila",
          })
        : "48 hours";

      const result = await email.sendPaymentInfo({
        to: row.email,
        orderId: row.id,
        showbuyId,
        orderNumber,
        quantity: row.qty,
        sectionName,
        totalPesos: (row.total_centavos / 100).toLocaleString("en-PH"),
        paymentLines: payment
          ? [
              `${payment.platform} · ${payment.account_name} · ${payment.account_number}`,
            ]
          : [],
        deadlineManila: deadline,
        receiptPath: `/receipt/${row.receipt_token}`,
        rebatePesos:
          row.card_rebate_centavos > 0
            ? (row.card_rebate_centavos / 100).toLocaleString("en-PH")
            : null,
      });

      const next = applyProcessResult(
        order,
        "payment_details",
        result.ok ? "sent" : "failed",
        at,
        "",
      );
      await supabase
        .from("orders")
        .update({
          status: next.status,
          payment_email_sent_at: next.paymentEmailSentAt,
          manual_reason: next.manualReason,
        })
        .eq("id", row.id);
      if (result.ok) sent += 1;
      else failed += 1;
      continue;
    }

    const seatLabels = seats.map((seat) => seat.label);
    const firstSeat = seatLabels[0] ?? "seat";
    const claimParts = {
      section: abbreviateSectionCode(sectionName),
      order: formatClaimOrderId(orderNumber),
      seat: firstSeat,
      qty: row.qty,
      discount: claimDiscountCode({
        appliedDiscount: row.applied_discount,
        discountCard: row.discount_card,
      }),
    };
    let claimCode = order.claimCode;
    if (!claimCode) {
      claimCode = formatClaimCode(showbuy.claim_code_template, claimParts);
      const { error: claimError } = await supabase
        .from("orders")
        .update({ claim_code: claimCode })
        .eq("id", row.id);
      if (claimError) {
        claimCode = formatClaimCode(showbuy.claim_code_template, claimParts);
        await supabase.from("orders").update({ claim_code: claimCode }).eq("id", row.id);
      }
    }

    const result = await email.sendClaimCode({
      to: row.email,
      orderId: row.id,
      showbuyId,
      orderNumber,
      claimCode: claimCode!,
      seatLabels,
      sectionName,
      rebatePesos:
        row.card_rebate_centavos > 0
          ? (row.card_rebate_centavos / 100).toLocaleString("en-PH")
          : null,
    });

    const next = applyProcessResult(
      { ...order, claimCode },
      "claim_code",
      result.ok ? "sent" : "failed",
      at,
      claimCode!,
    );
    await supabase
      .from("orders")
      .update({
        status: next.status,
        claim_code: next.claimCode,
        claim_email_sent_at: next.claimEmailSentAt,
      })
      .eq("id", row.id);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  revalidatePath(`/dashboard/showbuys/${showbuyId}/orders`);
  return {
    ok: true,
    message: `Processed ${tasks.length}: ${sent} sent, ${failed} failed.`,
  };
}
