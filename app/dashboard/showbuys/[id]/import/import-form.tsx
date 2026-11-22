"use client";

import { useActionState } from "react";
import { saveSeatMapImport, type ImportState } from "./actions";

type Section = {
  id: string;
  name: string;
  regular_price_centavos: number;
  t2m_ticket_type_ids: number[] | null;
  is_for_sale: boolean;
};

type Props = {
  showbuyId: string;
  ticketTypes: number[];
  existingSections: Section[];
  unavailable: { seatId: number; label: string }[];
  hasExistingSeats: boolean;
  feedPreview: {
    rowNumber: number;
    seats: { seat_no: string; status: number }[];
  }[];
};

function sectionForType(sections: Section[], ticketType: number): Section | undefined {
  return sections.find((section) => section.t2m_ticket_type_ids?.includes(ticketType));
}

export function ImportForm({
  showbuyId,
  ticketTypes,
  existingSections,
  unavailable,
  hasExistingSeats,
  feedPreview,
}: Props) {
  const action = saveSeatMapImport.bind(null, showbuyId);
  const [state, formAction, pending] = useActionState<ImportState | null, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="mt-8 space-y-10">
      {state && !state.ok ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.reason}
          {state.reviewAgain ? " — review the map again; the feed changed." : ""}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Sections</h2>
        <p className="text-sm text-zinc-600">
          Map each ticket type to a section and price (pesos). Only for-sale sections can be held.
        </p>
        {ticketTypes.map((type) => {
          const existing = sectionForType(existingSections, type);
          return (
            <div key={type} className="grid gap-2 rounded border border-zinc-200 p-4 sm:grid-cols-4">
              <input type="hidden" name="ticketType" value={type} />
              <input type="hidden" name="sectionId" value={existing?.id ?? ""} />
              <label className="text-sm sm:col-span-1">
                Ticket {type}
                <input
                  name="sectionName"
                  defaultValue={existing?.name ?? `Type ${type}`}
                  className="mt-1 w-full rounded border px-2 py-1"
                  required
                />
              </label>
              <label className="text-sm">
                Price (₱)
                <input
                  name="sectionPricePesos"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={
                    existing ? (existing.regular_price_centavos / 100).toFixed(0) : "5000"
                  }
                  className="mt-1 w-full rounded border px-2 py-1"
                  required
                />
              </label>
              <label className="text-sm">
                For sale
                <select
                  name={`sectionForSale-${type}`}
                  defaultValue={existing?.is_for_sale === false ? "off" : "on"}
                  className="mt-1 w-full rounded border px-2 py-1"
                >
                  <option value="on">Yes</option>
                  <option value="off">No</option>
                </select>
              </label>
            </div>
          );
        })}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Map preview</h2>
        <div className="overflow-x-auto rounded border border-zinc-200 p-4 font-mono text-xs">
          {feedPreview.map((row) => (
            <div key={row.rowNumber} className="flex gap-1 py-0.5">
              <span className="w-8 text-zinc-400">R{row.rowNumber}</span>
              {row.seats.map((seat, index) => (
                <span
                  key={`${row.rowNumber}-${index}`}
                  className={
                    seat.seat_no === "EMPTY"
                      ? "inline-block w-10 text-center text-zinc-300"
                      : "inline-block w-10 rounded bg-zinc-100 text-center"
                  }
                  title={`status ${seat.status}`}
                >
                  {seat.seat_no === "EMPTY" ? "·" : seat.seat_no}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Unavailable seats</h2>
        <p className="text-sm text-zinc-600">Default is house. Mark direct buy or sold direct as needed.</p>
        <div className="space-y-2">
          {unavailable.map((seat) => (
            <label key={seat.seatId} className="flex items-center gap-3 text-sm">
              <span className="w-12 font-mono">{seat.label}</span>
              <select
                name={`class-${seat.seatId}`}
                defaultValue="house"
                className="rounded border px-2 py-1"
              >
                <option value="house">House</option>
                <option value="direct_buy">Direct buy</option>
                <option value="sold_direct">Sold direct</option>
              </select>
            </label>
          ))}
        </div>
      </section>

      {hasExistingSeats ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirmReplace" />
          Replace existing seats for this showbuy
        </label>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save seat map"}
      </button>
    </form>
  );
}
