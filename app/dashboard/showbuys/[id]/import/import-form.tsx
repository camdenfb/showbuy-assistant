"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { T2mShowTicket } from "@/lib/adapters/ticket2me";
import type { UnavailableClass } from "@/lib/rules/import-map";
import {
  saveSeatMapImport,
  saveSectionSettings,
  type ImportState,
  type SectionSaveState,
} from "./actions";

type Section = {
  id: string;
  name: string;
  regular_price_centavos: number;
  t2m_ticket_type_ids: number[] | null;
  is_for_sale: boolean;
};

type FeedSeat = {
  seatId: number;
  label: string;
  ticketTypeId: number;
  t2mStatus: number;
};

type Props = {
  showbuyId: string;
  ticketTypes: number[];
  ticketMetaById: Record<number, T2mShowTicket>;
  existingSections: Section[];
  seats: FeedSeat[];
  savedClassifications: Record<number, UnavailableClass>;
  hasExistingSeats: boolean;
  feedPreview: {
    rowNumber: number;
    seats: { seat_no: string; status: number; ticket_id: number }[];
  }[];
};

const NOT_FOR_SALE_BG = "#3f3f46";

const CLASS_COLORS: Record<UnavailableClass, { bg: string; label: string }> = {
  house: { bg: "#e4e4e7", label: "House" },
  direct_buy: { bg: "#99f6e4", label: "Direct buy" },
  sold_direct: { bg: "#c4b5fd", label: "Sold direct" },
  sold_t2m: { bg: "#fca5a5", label: "Sold (T2M)" },
};

function t2mStatusStyle(status: number): { bg: string; label: string } {
  if (status === 0) return { bg: "#86efac", label: "On sale (T2M)" };
  if (status === 2) return { bg: "#fca5a5", label: "Sold (T2M)" };
  if (status === -1) return { bg: "#d6d3d1", label: "Unavailable (T2M)" };
  return { bg: "#d4d4d8", label: `Status ${status}` };
}

const T2M_STATUS_LEGEND = [
  t2mStatusStyle(0),
  t2mStatusStyle(2),
  t2mStatusStyle(-1),
] as const;

function sectionForType(sections: Section[], ticketType: number): Section | undefined {
  return sections.find((section) => section.t2m_ticket_type_ids?.includes(ticketType));
}

function sectionNameFromPull(title: string): string {
  return title
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word === "-") return word;
      if (word.length <= 1) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function categoryFromPull(title: string): string {
  const head = title.split(" - ")[0]?.trim() || title;
  return sectionNameFromPull(head);
}

function labelForType(
  type: number,
  ticketMetaById: Record<number, T2mShowTicket>,
): string {
  const meta = ticketMetaById[type];
  return meta ? sectionNameFromPull(meta.title) : `Type ${type}`;
}

function isClassifiable(t2mStatus: number): boolean {
  return t2mStatus === -1 || t2mStatus === 2;
}

type MapCell = { seat_no: string; status: number; ticket_id: number };

/** Outer edges only — outlines a whole for-sale block, not every seat. */
function sectionOutlineShadow(
  feed: { seats: MapCell[] }[],
  rowIndex: number,
  colIndex: number,
  ticketId: number,
  forSaleByType: Record<number, boolean>,
  sectionColor: string,
): string {
  if (!forSaleByType[ticketId]) {
    return "inset 0 0 0 1px #52525b";
  }

  const sameBlock = (r: number, c: number): boolean => {
    const cell = feed[r]?.seats[c];
    if (!cell || cell.seat_no === "EMPTY") return false;
    return cell.ticket_id === ticketId && forSaleByType[cell.ticket_id] === true;
  };

  const w = 2;
  const parts: string[] = [];
  if (!sameBlock(rowIndex, colIndex - 1)) parts.push(`inset ${w}px 0 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex, colIndex + 1)) parts.push(`inset -${w}px 0 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex - 1, colIndex)) parts.push(`inset 0 ${w}px 0 0 ${sectionColor}`);
  if (!sameBlock(rowIndex + 1, colIndex)) parts.push(`inset 0 -${w}px 0 0 ${sectionColor}`);
  return parts.join(", ");
}

function defaultClassFor(
  seat: FeedSeat,
  saved: Record<number, UnavailableClass>,
): UnavailableClass {
  if (saved[seat.seatId]) return saved[seat.seatId]!;
  if (seat.t2mStatus === 2) return "sold_t2m";
  return "house";
}

function SectionAccordion({
  showbuyId,
  type,
  meta,
  existing,
  onForSaleChange,
}: {
  showbuyId: string;
  type: number;
  meta: T2mShowTicket | undefined;
  existing: Section | undefined;
  onForSaleChange: (forSale: boolean) => void;
}) {
  const router = useRouter();
  const bound = saveSectionSettings.bind(null, showbuyId);
  const [state, formAction, pending] = useActionState<SectionSaveState | null, FormData>(
    bound,
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const color = meta?.color ?? "#a1a1aa";
  const defaultName = existing?.name
    ? existing.name
    : meta
      ? sectionNameFromPull(meta.title)
      : `Type ${type}`;
  const defaultPrice = existing
    ? (existing.regular_price_centavos / 100).toFixed(0)
    : meta
      ? String(Math.round(meta.pricePesos))
      : "5000";
  const defaultForSale = existing ? existing.is_for_sale !== false : false;

  return (
    <details className="rounded border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm text-zinc-900">
        <span
          className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-300"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium">
          {existing?.name ?? (meta ? sectionNameFromPull(meta.title) : `Type ${type}`)}
        </span>
        <span className="text-zinc-500">
          ₱
          {existing
            ? (existing.regular_price_centavos / 100).toLocaleString("en-PH")
            : meta
              ? Math.round(meta.pricePesos).toLocaleString("en-PH")
              : "—"}
        </span>
        <span className="ml-auto text-xs text-zinc-500">
          {defaultForSale ? "For sale" : "Not for sale"} · id {type}
        </span>
      </summary>

      <form action={formAction} className="space-y-3 border-t border-zinc-200 px-4 py-4">
        <input type="hidden" name="ticketType" value={type} />
        <input type="hidden" name="sectionId" value={existing?.id ?? ""} />
        {meta ? (
          <p className="text-xs text-zinc-500">
            Ticket2Me: {sectionNameFromPull(meta.title)} · ₱
            {Math.round(meta.pricePesos).toLocaleString("en-PH")} (reference only — your saved
            values win)
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-zinc-800 sm:col-span-1">
            Section name
            <input
              name="sectionName"
              defaultValue={defaultName}
              key={`name-${existing?.id ?? type}-${defaultName}`}
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
              required
            />
          </label>
          <label className="text-sm text-zinc-800">
            Price (₱)
            <input
              name="sectionPricePesos"
              type="number"
              min={0}
              step={1}
              defaultValue={defaultPrice}
              key={`price-${existing?.id ?? type}-${defaultPrice}`}
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
              required
            />
          </label>
          <label className="text-sm text-zinc-800">
            For sale
            <select
              name="sectionForSale"
              defaultValue={defaultForSale ? "on" : "off"}
              key={`sale-${existing?.id ?? type}-${defaultForSale}`}
              onChange={(event) => onForSaleChange(event.target.value === "on")}
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
            >
              <option value="on">Yes</option>
              <option value="off">No</option>
            </select>
          </label>
        </div>
        {state && !state.ok ? (
          <p className="text-sm text-red-700">{state.reason}</p>
        ) : null}
        {state?.ok ? <p className="text-sm text-emerald-700">{state.message}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="btn-primary rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save section"}
        </button>
      </form>
    </details>
  );
}

export function ImportForm({
  showbuyId,
  ticketTypes,
  ticketMetaById,
  existingSections,
  seats,
  savedClassifications,
  hasExistingSeats,
  feedPreview,
}: Props) {
  const action = saveSeatMapImport.bind(null, showbuyId);
  const [state, formAction, pending] = useActionState<ImportState | null, FormData>(
    action,
    null,
  );

  const [forSaleByType, setForSaleByType] = useState<Record<number, boolean>>(() => {
    const out: Record<number, boolean> = {};
    for (const type of ticketTypes) {
      const existing = sectionForType(existingSections, type);
      out[type] = existing ? existing.is_for_sale !== false : false;
    }
    return out;
  });

  useEffect(() => {
    setForSaleByType((prev) => {
      const next = { ...prev };
      for (const type of ticketTypes) {
        const existing = sectionForType(existingSections, type);
        if (existing) next[type] = existing.is_for_sale !== false;
      }
      return next;
    });
  }, [existingSections, ticketTypes]);

  const seatsByType = useMemo(() => {
    const map = new Map<number, FeedSeat[]>();
    for (const seat of seats) {
      const list = map.get(seat.ticketTypeId) ?? [];
      list.push(seat);
      map.set(seat.ticketTypeId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    return map;
  }, [seats]);

  const sellingTypes = useMemo(
    () => ticketTypes.filter((type) => forSaleByType[type]),
    [ticketTypes, forSaleByType],
  );

  const [selectedType, setSelectedType] = useState<number>(() => sellingTypes[0] ?? 0);

  useEffect(() => {
    if (sellingTypes.length === 0) return;
    if (!sellingTypes.includes(selectedType)) {
      setSelectedType(sellingTypes[0]!);
    }
  }, [sellingTypes, selectedType]);

  const classifiableSeats = useMemo(
    () => seats.filter((seat) => isClassifiable(seat.t2mStatus)),
    [seats],
  );

  const [classes, setClasses] = useState<Record<number, UnavailableClass>>(() => {
    const initial: Record<number, UnavailableClass> = {};
    for (const seat of seats) {
      if (isClassifiable(seat.t2mStatus)) {
        initial[seat.seatId] = defaultClassFor(seat, savedClassifications);
      }
    }
    return initial;
  });

  const selectedSeats = seatsByType.get(selectedType) ?? [];
  const selectedClassifiable = selectedSeats.filter((seat) => isClassifiable(seat.t2mStatus));

  function setClass(seatId: number, value: UnavailableClass) {
    setClasses((prev) => ({ ...prev, [seatId]: value }));
  }

  function setAllClassifiableInSection(value: UnavailableClass) {
    setClasses((prev) => {
      const next = { ...prev };
      for (const seat of selectedClassifiable) {
        if (seat.t2mStatus === -1 && value === "sold_t2m") continue;
        next[seat.seatId] = value;
      }
      return next;
    });
  }

  const missingSections = ticketTypes.filter(
    (type) => !sectionForType(existingSections, type),
  );

  return (
    <div className="mt-8 space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-zinc-900">Sections</h2>
        <p className="text-sm text-zinc-600">
          Open a section, set name/price/for sale, and save. Saved values persist — Ticket2Me
          prices are reference only and do not overwrite on sync.
        </p>
        {ticketTypes.map((type) => (
          <SectionAccordion
            key={type}
            showbuyId={showbuyId}
            type={type}
            meta={ticketMetaById[type]}
            existing={sectionForType(existingSections, type)}
            onForSaleChange={(forSale) =>
              setForSaleByType((prev) => ({ ...prev, [type]: forSale }))
            }
          />
        ))}
      </section>

      <form action={formAction} className="space-y-10">
        {classifiableSeats.map((seat) => (
          <input
            key={`hidden-${seat.seatId}`}
            type="hidden"
            name={`class-${seat.seatId}`}
            value={classes[seat.seatId] ?? defaultClassFor(seat, savedClassifications)}
          />
        ))}

        {state && !state.ok ? (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.reason === "confirm replace required"
              ? "This showbuy already has a seat map. Check “Replace the existing seat map” at the bottom, then save again."
              : state.reason}
            {state.reviewAgain ? " — review the map again; the feed changed." : ""}
          </p>
        ) : null}

        {missingSections.length > 0 ? (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Save every section above before importing seats. Missing:{" "}
            {missingSections.map((type) => labelForType(type, ticketMetaById)).join(", ")}
          </p>
        ) : null}

        <section className="space-y-4">
          <h2 className="text-lg font-medium text-zinc-900">Map preview</h2>
          <p className="text-sm text-zinc-600">
            Dark grey fill = not for sale. For-sale seats use Ticket2Me status as fill; Talent /
            Heart (and other for-sale sections) get one outline around the whole block.
          </p>
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white p-4 font-mono text-[10px] leading-none">
            {feedPreview.map((row, rowIndex) => (
              <div key={row.rowNumber} className="flex">
                <span className="flex w-8 shrink-0 items-center text-zinc-500">R{row.rowNumber}</span>
                {row.seats.map((seat, colIndex) => {
                  if (seat.seat_no === "EMPTY") {
                    return (
                      <span
                        key={`${row.rowNumber}-${colIndex}`}
                        className="inline-flex h-5 w-9 shrink-0 items-center justify-center text-zinc-400"
                      >
                        ·
                      </span>
                    );
                  }
                  const forSale = forSaleByType[seat.ticket_id] === true;
                  const statusStyle = t2mStatusStyle(seat.status);
                  const sectionColor = ticketMetaById[seat.ticket_id]?.color ?? "#a1a1aa";
                  const bg = forSale ? statusStyle.bg : NOT_FOR_SALE_BG;
                  const text = forSale ? "#18181b" : "#fafafa";
                  return (
                    <span
                      key={`${row.rowNumber}-${colIndex}`}
                      className="inline-flex h-5 w-9 shrink-0 items-center justify-center font-semibold"
                      style={{
                        backgroundColor: bg,
                        color: text,
                        boxShadow: sectionOutlineShadow(
                          feedPreview,
                          rowIndex,
                          colIndex,
                          seat.ticket_id,
                          forSaleByType,
                          sectionColor,
                        ),
                      }}
                      title={
                        forSale
                          ? `${seat.seat_no} · ${statusStyle.label}`
                          : `${seat.seat_no} · not for sale`
                      }
                    >
                      {seat.seat_no}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-700">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
                style={{ backgroundColor: NOT_FOR_SALE_BG }}
              />
              Not for sale
            </span>
            {T2M_STATUS_LEGEND.map((style) => (
              <span key={style.label} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
                  style={{ backgroundColor: style.bg }}
                />
                {style.label}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-700">
            {Array.from(
              new Map(
                ticketTypes.map((type) => {
                  const meta = ticketMetaById[type];
                  const category = meta ? categoryFromPull(meta.title) : `Type ${type}`;
                  const price = meta ? Math.round(meta.pricePesos) : null;
                  const color = meta?.color ?? "#a1a1aa";
                  return [`${category}|${price}|${color}`, { category, price, color }] as const;
                }),
              ).values(),
            ).map((entry) => (
              <span
                key={`${entry.category}-${entry.price}-${entry.color}`}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-zinc-300"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="font-medium text-zinc-900">{entry.category}</span>
                {entry.price != null ? (
                  <span className="text-zinc-600">
                    ₱{entry.price.toLocaleString("en-PH")}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium text-zinc-900">Seats in sections for sale</h2>
          <p className="text-sm text-zinc-600">
            Layout is top-to-bottom, then column 1 then column 2. Unavailable and sold Ticket2Me
            seats are editable (sold may be a pull-out). On-sale seats stay Ticket2Me.
          </p>

          {sellingTypes.length === 0 ? (
            <p className="text-sm text-zinc-600">
              Mark at least one section as for sale (and save it) to classify its seats.
            </p>
          ) : (
            <>
              <label className="block max-w-md text-sm text-zinc-800">
                Section
                <select
                  value={selectedType}
                  onChange={(event) => setSelectedType(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-zinc-900"
                >
                  {sellingTypes.map((type) => (
                    <option key={type} value={type}>
                      {labelForType(type, ticketMetaById)} (
                      {seatsByType.get(type)?.length ?? 0} seats)
                    </option>
                  ))}
                </select>
              </label>

              {selectedClassifiable.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-zinc-600">Set all editable in this section:</span>
                  {(Object.keys(CLASS_COLORS) as UnavailableClass[])
                    .filter((key) => key !== "sold_t2m")
                    .map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAllClassifiableInSection(key)}
                        className="rounded border border-zinc-400 px-2 py-1 font-medium text-zinc-900"
                        style={{ backgroundColor: CLASS_COLORS[key].bg, color: "#18181b" }}
                      >
                        {CLASS_COLORS[key].label}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => setAllClassifiableInSection("sold_t2m")}
                    className="rounded border border-zinc-400 px-2 py-1 font-medium text-zinc-900"
                    style={{ backgroundColor: CLASS_COLORS.sold_t2m.bg, color: "#18181b" }}
                  >
                    Sold (T2M) — sold seats only
                  </button>
                </div>
              ) : null}

              <div className="columns-2 gap-3">
                {selectedSeats.map((seat) => {
                  if (seat.t2mStatus === 0) {
                    const statusStyle = t2mStatusStyle(0);
                    return (
                      <div
                        key={seat.seatId}
                        className="mb-2 break-inside-avoid flex items-center gap-3 rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                        style={{ backgroundColor: statusStyle.bg }}
                      >
                        <span className="w-12 font-mono font-semibold">{seat.label}</span>
                        <span>{statusStyle.label}</span>
                      </div>
                    );
                  }

                  const value = classes[seat.seatId] ?? defaultClassFor(seat, savedClassifications);
                  const style = CLASS_COLORS[value];
                  return (
                    <label
                      key={seat.seatId}
                      className="mb-2 break-inside-avoid flex items-center gap-3 rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-900"
                      style={{ backgroundColor: style.bg }}
                    >
                      <span className="w-12 font-mono font-semibold">{seat.label}</span>
                      <select
                        value={value}
                        onChange={(event) =>
                          setClass(seat.seatId, event.target.value as UnavailableClass)
                        }
                        className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900"
                      >
                        {seat.t2mStatus === 2 ? (
                          <option value="sold_t2m">Sold (T2M)</option>
                        ) : null}
                        <option value="house">House</option>
                        <option value="direct_buy">Direct buy</option>
                        <option value="sold_direct">Sold direct</option>
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-500">
                Showing {selectedSeats.length} seats ({selectedClassifiable.length} editable).
              </p>
            </>
          )}
        </section>

        {hasExistingSeats ||
        (state != null && !state.ok && state.reason === "confirm replace required") ? (
          <label className="flex items-start gap-3 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-zinc-900">
            <input
              type="checkbox"
              name="confirmReplace"
              value="on"
              className="mt-1 h-4 w-4 shrink-0"
              required={
                hasExistingSeats ||
                (state != null && !state.ok && state.reason === "confirm replace required")
              }
            />
            <span>
              <span className="font-medium">Replace the existing seat map</span>
              <span className="mt-1 block text-zinc-700">
                Re-imports seats and classifications. Section names and prices stay as you saved
                them above.
              </span>
            </span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={pending || missingSections.length > 0}
          className="btn-primary rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save seat map"}
        </button>
      </form>
    </div>
  );
}
