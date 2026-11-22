"use client";

import { useActionState, useMemo, useState } from "react";
import {
  confirmSuggestion,
  previewQuote,
  submitOrder,
  type QuoteState,
  type SubmitState,
  type SuggestionOption,
} from "./actions";

type SeatView = {
  id: string;
  label: string;
  sectionId: string;
  status: string;
  gridRow: number;
  position: number;
  conflict: string | null;
};

type SectionView = {
  id: string;
  name: string;
  regular_price_centavos: number;
  is_for_sale: boolean;
  color: string;
};

type PaymentView = {
  id: string;
  platform: string;
  account_name: string;
};

type Props = {
  showbuyId: string;
  showbuyName: string;
  eventUrl: string;
  ordersPaused: boolean;
  sections: SectionView[];
  seats: SeatView[];
  payments: PaymentView[];
};

const COLOR_FIRST = "#99f6e4";
const COLOR_SECOND = "#c4b5fd";
const COLOR_AVAILABLE = "#fafafa";
const COLOR_T2M = "#86efac";
const COLOR_UNAVAILABLE = "#71717a";

function pesos(centavos: number): string {
  return (centavos / 100).toLocaleString("en-PH");
}

function isDirectBuy(seat: SeatView): boolean {
  return seat.status === "direct_buy" && seat.conflict === null;
}

function isTicket2Me(seat: SeatView): boolean {
  return seat.status === "available_t2m";
}

type SectionBand = {
  key: string;
  label: string;
  priceCentavos: number;
  color: string;
  sectionIds: string[];
  primarySectionId: string;
};

/** Group for-sale sections that share the same saved name (e.g. all "Heart"). */
function buildSectionBands(sections: SectionView[]): SectionBand[] {
  const forSale = sections.filter((section) => section.is_for_sale !== false);
  const byName = new Map<string, SectionView[]>();
  for (const section of forSale) {
    const key = section.name.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(section);
    byName.set(key, list);
  }
  return [...byName.entries()]
    .sort((a, b) => a[1][0]!.name.localeCompare(b[1][0]!.name))
    .map(([key, group]) => {
      const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
      const primary = sorted[0]!;
      return {
        key,
        label: primary.name.trim(),
        priceCentavos: primary.regular_price_centavos,
        color: primary.color,
        sectionIds: sorted.map((section) => section.id),
        primarySectionId: primary.id,
      };
    });
}

/** Outer edges only — outlines a whole named section block, not every seat. */
function sectionOutlineShadow(
  cellAt: (rowIndex: number, colIndex: number) => SeatView | null,
  rowIndex: number,
  colIndex: number,
  bandSectionIds: ReadonlySet<string>,
  sectionColor: string,
): string {
  const sameBlock = (r: number, c: number): boolean => {
    const cell = cellAt(r, c);
    return cell != null && bandSectionIds.has(cell.sectionId);
  };

  const w = 2;
  const parts: string[] = [];
  if (!sameBlock(rowIndex, colIndex - 1)) parts.push(`inset ${w}px 0 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex, colIndex + 1)) parts.push(`inset -${w}px 0 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex - 1, colIndex)) parts.push(`inset 0 ${w}px 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex + 1, colIndex)) parts.push(`inset 0 -${w}px 0 0 ${sectionColor}`);
  return parts.join(", ");
}

export function OrderForm({
  showbuyId,
  showbuyName,
  eventUrl,
  ordersPaused,
  sections,
  seats,
  payments,
}: Props) {
  const sectionBands = useMemo(() => buildSectionBands(sections), [sections]);
  const [preferredBandKey, setPreferredBandKey] = useState(
    () => sectionBands[0]?.key ?? "",
  );
  const preferredBand =
    sectionBands.find((band) => band.key === preferredBandKey) ?? sectionBands[0];
  const preferredSectionId = preferredBand?.primarySectionId ?? "";
  const preferredSectionIdSet = useMemo(
    () => new Set(preferredBand?.sectionIds ?? []),
    [preferredBand],
  );
  const [qty, setQty] = useState(1);
  const [firstChoice, setFirstChoice] = useState<string[]>([]);
  const [secondChoice, setSecondChoice] = useState<string[]>([]);
  const [activeChoice, setActiveChoice] = useState<"first" | "second">("first");
  const [hideTicket2Me, setHideTicket2Me] = useState(true);
  const [discountCard, setDiscountCard] = useState<"none" | "pwd" | "senior">("none");
  const [promoCode, setPromoCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [note, setNote] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState(payments[0]?.id ?? "");
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [hideSuggestions, setHideSuggestions] = useState(false);

  const submitBound = submitOrder.bind(null, showbuyId);
  const confirmBound = confirmSuggestion.bind(null, showbuyId);
  const [submitState, submitAction, submitPending] = useActionState<
    SubmitState | null,
    FormData
  >(submitBound, null);
  const [confirmState, confirmAction, confirmPending] = useActionState<
    SubmitState | null,
    FormData
  >(confirmBound, null);

  const suggestions: SuggestionOption[] | null = hideSuggestions
    ? null
    : submitState && !submitState.ok && submitState.suggestions
      ? submitState.suggestions
      : confirmState && !confirmState.ok && confirmState.suggestions
        ? confirmState.suggestions
        : null;

  const bandBySectionId = useMemo(() => {
    const map = new Map<string, SectionBand>();
    for (const band of sectionBands) {
      for (const id of band.sectionIds) map.set(id, band);
    }
    return map;
  }, [sectionBands]);

  const mapRows = useMemo(() => {
    const byRow = new Map<number, Map<number, SeatView>>();
    let maxPos = 0;
    for (const seat of seats) {
      const row = byRow.get(seat.gridRow) ?? new Map<number, SeatView>();
      row.set(seat.position, seat);
      byRow.set(seat.gridRow, row);
      if (seat.position > maxPos) maxPos = seat.position;
    }
    const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);
    const cellAt = (rowIndex: number, colIndex: number): SeatView | null => {
      const rowNumber = rowNumbers[rowIndex];
      if (rowNumber == null) return null;
      return byRow.get(rowNumber)?.get(colIndex + 1) ?? null;
    };
    return { rowNumbers, byRow, maxPos, cellAt };
  }, [seats]);

  const labelFor = (id: string) =>
    seats.find((seat) => seat.id === id)?.label ?? id.slice(0, 6);

  function toggleSeat(seat: SeatView) {
    const showT2m = isTicket2Me(seat) && !hideTicket2Me;
    if (showT2m) {
      const go = window.confirm(
        "This seat is available for purchase in Ticket2Me. Do you want to be redirected to Ticket2Me?",
      );
      if (go) window.open(eventUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const pickable =
      isDirectBuy(seat) && preferredSectionIdSet.has(seat.sectionId);
    if (!pickable) return;

    const other = activeChoice === "first" ? secondChoice : firstChoice;
    if (other.includes(seat.id)) return;

    const current = activeChoice === "first" ? firstChoice : secondChoice;
    const setter = activeChoice === "first" ? setFirstChoice : setSecondChoice;

    if (current.includes(seat.id)) {
      setter(current.filter((id) => id !== seat.id));
      return;
    }
    if (current.length >= qty) return;
    setter([...current, seat.id]);
  }

  function seatAppearance(seat: SeatView): {
    bg: string;
    color: string;
    title: string;
    interactive: boolean;
  } {
    if (firstChoice.includes(seat.id)) {
      return {
        bg: COLOR_FIRST,
        color: "#18181b",
        title: "First choice",
        interactive: true,
      };
    }
    if (secondChoice.includes(seat.id)) {
      return {
        bg: COLOR_SECOND,
        color: "#18181b",
        title: "Second choice",
        interactive: true,
      };
    }
    if (isTicket2Me(seat)) {
      if (hideTicket2Me) {
        return {
          bg: COLOR_UNAVAILABLE,
          color: "#fafafa",
          title: "Not available",
          interactive: false,
        };
      }
      return {
        bg: COLOR_T2M,
        color: "#18181b",
        title: "Buy on Ticket2Me",
        interactive: true,
      };
    }
    if (isDirectBuy(seat) && preferredSectionIdSet.has(seat.sectionId)) {
      return {
        bg: COLOR_AVAILABLE,
        color: "#18181b",
        title: "Available",
        interactive: true,
      };
    }
    return {
      bg: COLOR_UNAVAILABLE,
      color: "#fafafa",
      title: "Not available",
      interactive: false,
    };
  }

  async function refreshQuote(seatIds: string[]) {
    if (seatIds.length === 0) {
      setQuote(null);
      return;
    }
    const data = new FormData();
    for (const id of seatIds) data.append("seatId", id);
    data.set("discountCard", discountCard);
    data.set("promoCode", promoCode);
    setQuote(await previewQuote(showbuyId, data));
  }

  const success = submitState?.ok
    ? submitState
    : confirmState?.ok
      ? confirmState
      : null;

  if (success) {
    return (
      <div className="space-y-3 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p className="font-medium">Seats held. Payment details were emailed.</p>
        <p className="text-zinc-700">
          In demo mode, open the showbuyer outbox later — message for order{" "}
          <span className="font-mono">{success.orderId.slice(0, 8)}</span>.
        </p>
      </div>
    );
  }

  if (suggestions && suggestions.length > 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-zinc-900">Suggested seats</h2>
        <p className="text-sm text-zinc-600">
          Both choices were unavailable. Confirm one option to hold it.
        </p>
        {(submitState && !submitState.ok && submitState.hasUncheckableRequest) ||
        (confirmState && !confirmState.ok && confirmState.hasUncheckableRequest) ? (
          <p className="text-sm text-amber-800">
            Part of your note can’t be checked on this map — contact the showbuyer.
          </p>
        ) : null}
        {suggestions.map((option) => (
          <form key={option.id} action={confirmAction} className="rounded border border-zinc-200 p-3">
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="mobile" value={mobile} />
            <input type="hidden" name="note" value={note} />
            <input type="hidden" name="preferredSectionId" value={preferredSectionId} />
            <input type="hidden" name="qty" value={qty} />
            <input type="hidden" name="idempotencyKey" value={`${idempotencyKey}-${option.id}`} />
            <input type="hidden" name="discountCard" value={discountCard} />
            <input type="hidden" name="promoCode" value={promoCode} />
            <input type="hidden" name="paymentAccountId" value={paymentAccountId} />
            {firstChoice.map((id) => (
              <input key={`f-${id}`} type="hidden" name="firstChoice" value={id} />
            ))}
            {secondChoice.map((id) => (
              <input key={`s-${id}`} type="hidden" name="secondChoice" value={id} />
            ))}
            {option.seatIds.map((id) => (
              <input key={id} type="hidden" name="suggestedSeatId" value={id} />
            ))}
            <p className="font-medium text-zinc-900">{option.labels.join(", ")}</p>
            <p className="text-sm text-zinc-600">{option.reason}</p>
            <p className="mt-1 text-sm">
              ₱{pesos(option.totalCentavos)}
              {option.cardRebateCentavos > 0
                ? ` · rebate ₱${pesos(option.cardRebateCentavos)}`
                : ""}
            </p>
            <button
              type="submit"
              disabled={confirmPending || !name || !email || !mobile}
              className="btn-primary mt-3 rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              {confirmPending ? "Holding…" : "Confirm these seats"}
            </button>
          </form>
        ))}
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setHideSuggestions(true)}
        >
          Back to map
        </button>
      </div>
    );
  }

  const firstCount = firstChoice.length;
  const secondCount = secondChoice.length;

  return (
    <form action={submitAction} className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">{showbuyName}</h1>
        {ordersPaused ? (
          <p className="mt-2 text-sm text-amber-800">Ordering is briefly unavailable.</p>
        ) : null}
      </div>

      <label className="block text-sm text-zinc-800">
        Preferred section
        <select
          value={preferredBand?.key ?? ""}
          onChange={(event) => {
            setPreferredBandKey(event.target.value);
            setFirstChoice([]);
            setSecondChoice([]);
          }}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        >
          {sectionBands.map((band) => (
            <option key={band.key} value={band.key}>
              {band.label} · ₱{pesos(band.priceCentavos)}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="preferredSectionId" value={preferredSectionId} />

      <label className="block text-sm text-zinc-800">
        Quantity
        <input
          name="qty"
          type="number"
          min={1}
          max={10}
          value={qty}
          onChange={(event) => {
            const next = Math.max(1, Math.min(10, Number(event.target.value) || 1));
            setQty(next);
            setFirstChoice((ids) => ids.slice(0, next));
            setSecondChoice((ids) => ids.slice(0, next));
          }}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            className={
              activeChoice === "first"
                ? "rounded px-3 py-2 font-medium"
                : "rounded border border-zinc-300 px-3 py-2 text-zinc-900"
            }
            style={
              activeChoice === "first"
                ? { backgroundColor: COLOR_FIRST, color: "#18181b" }
                : undefined
            }
            onClick={() => setActiveChoice("first")}
          >
            First choice · {firstCount} of {qty}
          </button>
          <button
            type="button"
            className={
              activeChoice === "second"
                ? "rounded px-3 py-2 font-medium"
                : "rounded border border-zinc-300 px-3 py-2 text-zinc-900"
            }
            style={
              activeChoice === "second"
                ? { backgroundColor: COLOR_SECOND, color: "#18181b" }
                : undefined
            }
            onClick={() => setActiveChoice("second")}
          >
            Second choice · {secondCount} of {qty}
          </button>
        </div>
        <p className="text-sm text-zinc-600">
          {activeChoice === "first"
            ? `Tap ${qty} seat${qty === 1 ? "" : "s"} on the map for your first choice.`
            : `Tap ${qty} backup seat${qty === 1 ? "" : "s"} — used only if the first are taken.`}
        </p>
        <p className="text-sm text-zinc-700">
          First: {firstChoice.map(labelFor).join(", ") || "—"}
          <br />
          Second: {secondChoice.map(labelFor).join(", ") || "—"}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-800">
        <input
          type="checkbox"
          checked={hideTicket2Me}
          onChange={(event) => setHideTicket2Me(event.target.checked)}
          className="size-4 rounded border-zinc-300"
        />
        Only display direct buy seats, hide seats available on Ticket2Me
      </label>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-700">
          {sectionBands.map((band) => (
            <span key={band.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm bg-white"
                style={{ boxShadow: `inset 0 0 0 2px ${band.color}` }}
              />
              {band.label} · ₱{pesos(band.priceCentavos)}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white p-3 font-mono text-[9px] leading-none sm:text-[10px]">
          {mapRows.rowNumbers.map((rowNumber, rowIndex) => {
            const row = mapRows.byRow.get(rowNumber)!;
            return (
              <div key={rowNumber} className="flex">
                <span className="flex w-7 shrink-0 items-center text-zinc-500 sm:w-8">
                  R{rowNumber}
                </span>
                {Array.from({ length: mapRows.maxPos }, (_, colIndex) => {
                  const position = colIndex + 1;
                  const seat = row.get(position);
                  if (!seat) {
                    return (
                      <span
                        key={`${rowNumber}-${position}`}
                        className="inline-flex h-5 w-10 shrink-0 items-center justify-center text-zinc-300"
                      >
                        ·
                      </span>
                    );
                  }
                  const look = seatAppearance(seat);
                  const band = bandBySectionId.get(seat.sectionId);
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      disabled={!look.interactive}
                      onClick={() => toggleSeat(seat)}
                      title={`${seat.label} · ${look.title}`}
                      className="inline-flex h-5 w-10 shrink-0 items-center justify-center font-semibold disabled:cursor-default"
                      style={{
                        backgroundColor: look.bg,
                        color: look.color,
                        boxShadow: band
                          ? sectionOutlineShadow(
                              mapRows.cellAt,
                              rowIndex,
                              colIndex,
                              new Set(band.sectionIds),
                              band.color,
                            )
                          : undefined,
                      }}
                    >
                      {seat.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-700">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
              style={{ backgroundColor: COLOR_AVAILABLE }}
            />
            Available
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
              style={{ backgroundColor: COLOR_FIRST }}
            />
            First choice
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
              style={{ backgroundColor: COLOR_SECOND }}
            />
            Second choice
          </span>
          {!hideTicket2Me ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
                style={{ backgroundColor: COLOR_T2M }}
              />
              Buy on Ticket2Me
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
              style={{ backgroundColor: COLOR_UNAVAILABLE }}
            />
            Not available
          </span>
        </div>
      </div>

      {firstChoice.map((id) => (
        <input key={`first-${id}`} type="hidden" name="firstChoice" value={id} />
      ))}
      {secondChoice.map((id) => (
        <input key={`second-${id}`} type="hidden" name="secondChoice" value={id} />
      ))}

      <label className="block text-sm text-zinc-800">
        Name
        <input
          name="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>
      <label className="block text-sm text-zinc-800">
        Email
        <input
          name="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>
      <label className="block text-sm text-zinc-800">
        Mobile
        <input
          name="mobile"
          required
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>
      <label className="block text-sm text-zinc-800">
        Promo code
        <input
          name="promoCode"
          value={promoCode}
          onChange={(event) => setPromoCode(event.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>
      <label className="block text-sm text-zinc-800">
        Discount card
        <select
          name="discountCard"
          value={discountCard}
          onChange={(event) =>
            setDiscountCard(event.target.value as "none" | "pwd" | "senior")
          }
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        >
          <option value="none">None</option>
          <option value="pwd">PWD</option>
          <option value="senior">Senior</option>
        </select>
      </label>
      <label className="block text-sm text-zinc-800">
        Payment
        <select
          name="paymentAccountId"
          value={paymentAccountId}
          onChange={(event) => setPaymentAccountId(event.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        >
          {payments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {payment.platform.toUpperCase()} · {payment.account_name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-zinc-800">
        If both are unavailable, what matters most?
        <textarea
          name="note"
          maxLength={200}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Read by AI. Don’t include names or medical details."
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
        />
      </label>

      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
        <button
          type="button"
          className="mb-2 underline"
          onClick={() => void refreshQuote(firstChoice)}
        >
          Preview price for first choice
        </button>
        {quote?.ok ? (
          <p>
            Total ₱{pesos(quote.totalCentavos)}
            {quote.cardRebateCentavos > 0
              ? ` · show-day rebate ₱${pesos(quote.cardRebateCentavos)}`
              : ""}
            {quote.applied === "promo" ? " · promo (rebate off)" : ""}
          </p>
        ) : quote && !quote.ok ? (
          <p className="text-red-700">{quote.reason}</p>
        ) : (
          <p className="text-zinc-600">Select first-choice seats, then preview.</p>
        )}
      </div>

      {submitState && !submitState.ok && submitState.reason !== "suggestions" ? (
        <p className="text-sm text-red-700">{submitState.reason}</p>
      ) : null}

      <button
        type="submit"
        disabled={
          submitPending ||
          ordersPaused ||
          firstChoice.length !== qty ||
          secondChoice.length !== qty ||
          payments.length === 0
        }
        className="btn-primary w-full rounded bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitPending ? "Submitting…" : "Hold seats & get payment details"}
      </button>
    </form>
  );
}
