import { seatFromImport, type Seat, type SeatStatus, type T2mStatus } from "./seats";

export type T2mSeatCell = {
  ticket_id: number;
  seat_id: number;
  seat_no: string;
  status: 0 | 2 | -1;
};

export type T2mWireResponse = {
  success: boolean;
  status: string;
  data: {
    attributes: {
      rowNumber: number;
      seats: T2mSeatCell[];
    }[];
  };
};

export type T2mFeedRow = {
  rowNumber: number;
  seats: T2mSeatCell[];
};

/** Classification for Ticket2Me unavailable (-1) seats only. Wire 2 is sold there. */
export type UnavailableClass =
  | "house"
  | "direct_buy"
  | "on_hold"
  | "sold_direct"
  | "sold_t2m";

const UNAVAILABLE_CLASSES = new Set<UnavailableClass>([
  "house",
  "direct_buy",
  "on_hold",
  "sold_direct",
  "sold_t2m",
]);

export type MappedSeat = Seat & {
  t2mSeatId: number;
  ticketTypeId: number;
  t2mSalePriceCentavos: number | null;
  importedSalePriceCentavos: number | null;
};

type Fail = { ok: false; reason: string };
type OkFeed = { ok: true; feed: T2mFeedRow[] };

const LABEL_RE = /^([A-Z]+)(\d+)$/;

export function parseSeatLabel(
  seatNo: string,
): { row: string; number: number } | null {
  if (seatNo === "EMPTY") return null;
  const match = LABEL_RE.exec(seatNo);
  if (!match) return null;
  return { row: match[1]!, number: Number(match[2]) };
}

function isStatus(value: unknown): value is 0 | 2 | -1 {
  return value === 0 || value === 2 || value === -1;
}

export function validateT2mWire(input: unknown): OkFeed | Fail {
  if (!input || typeof input !== "object") return { ok: false, reason: "malformed" };
  const body = input as Partial<T2mWireResponse>;
  if (body.success !== true) return { ok: false, reason: "success_false" };
  const attributes = body.data?.attributes;
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return { ok: false, reason: "empty_feed" };
  }

  const width = attributes[0]?.seats?.length;
  if (!width || width < 1) return { ok: false, reason: "empty_feed" };

  const rowNumbers = new Set<number>();
  const labels = new Set<string>();
  const seatIds = new Set<number>();
  const feed: T2mFeedRow[] = [];

  for (const row of attributes) {
    if (!row || typeof row.rowNumber !== "number" || !Array.isArray(row.seats)) {
      return { ok: false, reason: "malformed" };
    }
    if (row.seats.length !== width) return { ok: false, reason: "unequal_width" };
    if (rowNumbers.has(row.rowNumber)) return { ok: false, reason: "duplicate_row" };
    rowNumbers.add(row.rowNumber);

    const seats: T2mSeatCell[] = [];
    for (const cell of row.seats) {
      if (!cell || typeof cell.seat_no !== "string") {
        return { ok: false, reason: "malformed" };
      }
      if (cell.seat_no === "") return { ok: false, reason: "blank_seat_no" };
      if (!isStatus(cell.status)) return { ok: false, reason: "unknown_status" };
      if (typeof cell.ticket_id !== "number" || typeof cell.seat_id !== "number") {
        return { ok: false, reason: "malformed" };
      }

      if (cell.seat_no === "EMPTY") {
        if (cell.seat_id !== 0 || cell.status !== -1) {
          return { ok: false, reason: "malformed_empty" };
        }
      } else {
        if (!parseSeatLabel(cell.seat_no)) return { ok: false, reason: "bad_label" };
        if (labels.has(cell.seat_no)) return { ok: false, reason: "duplicate_label" };
        labels.add(cell.seat_no);
        if (seatIds.has(cell.seat_id)) return { ok: false, reason: "duplicate_seat_id" };
        seatIds.add(cell.seat_id);
      }
      seats.push({
        ticket_id: cell.ticket_id,
        seat_id: cell.seat_id,
        seat_no: cell.seat_no,
        status: cell.status,
      });
    }
    feed.push({ rowNumber: row.rowNumber, seats });
  }

  return { ok: true, feed };
}

export function ticketTypesFromCells(feed: T2mFeedRow[]): number[] {
  const types = new Set<number>();
  for (const row of feed) {
    for (const cell of row.seats) {
      if (cell.seat_no !== "EMPTY") types.add(cell.ticket_id);
    }
  }
  return [...types].sort((a, b) => a - b);
}

function t2mStatusFromWire(status: 0 | 2 | -1): T2mStatus {
  // Ticket2Me: 0 = on sale; 2 = sold there; -1 = unavailable (we classify).
  if (status === 0) return "available";
  if (status === 2) return "sold";
  return "unavailable";
}

export function mapT2mFeed(input: {
  feed: T2mFeedRow[];
  showbuyId: string;
  sectionByTicketType: Record<number, string>;
  classifications: Record<number, UnavailableClass>;
  regularPriceBySection: Record<string, number>;
}): { ok: true; seats: MappedSeat[] } | Fail {
  const seats: MappedSeat[] = [];

  for (const row of input.feed) {
    for (let position = 0; position < row.seats.length; position++) {
      const cell = row.seats[position]!;
      if (cell.seat_no === "EMPTY") continue;

      const parsed = parseSeatLabel(cell.seat_no);
      if (!parsed) return { ok: false, reason: "bad_label" };

      const sectionId = input.sectionByTicketType[cell.ticket_id];
      if (!sectionId) return { ok: false, reason: "unmapped_ticket_type" };

      const classification = input.classifications[cell.seat_id];
      if (classification !== undefined) {
        // Only unavailable (-1) seats are classified; 0 and 2 come from Ticket2Me.
        if (cell.status !== -1 || !UNAVAILABLE_CLASSES.has(classification)) {
          return { ok: false, reason: "stale_classification" };
        }
      }

      const t2mStatus = t2mStatusFromWire(cell.status);
      const base = seatFromImport({
        id: `t2m-${cell.seat_id}`,
        showbuyId: input.showbuyId,
        sectionId,
        row: parsed.row,
        number: parsed.number,
        label: cell.seat_no,
        gridRow: row.rowNumber,
        position,
        t2mStatus,
      });

      let status: SeatStatus = base.status;
      if (cell.status === -1) {
        status = classification ?? "house";
      }

      const price = input.regularPriceBySection[sectionId] ?? 0;
      seats.push({
        ...base,
        status,
        t2mSeatId: cell.seat_id,
        ticketTypeId: cell.ticket_id,
        t2mSalePriceCentavos: status === "sold_t2m" ? price : null,
        importedSalePriceCentavos: status === "sold_direct" ? price : null,
      });
    }
  }

  return { ok: true, seats };
}
