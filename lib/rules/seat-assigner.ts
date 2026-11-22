import { canHold, checkSingle, type Seat, type SaleScope } from "./seats";

export type SeatFact =
  | "aisle"
  | "center"
  | "near_front"
  | "near_back"
  | "same_row"
  | "near_first_choice";

export type SeatCandidate = {
  id: string;
  seatIds: string[];
  rowsFromFront: number;
  rowsFromFirstChoice: number;
  seatsFromFirstChoice: number;
  facts: SeatFact[];
};

export type SeatPicks = {
  picks: { id: string; matchedFacts: SeatFact[] }[];
  hasUncheckableRequest: boolean;
};

const ALL_FACTS = new Set<SeatFact>([
  "aisle",
  "center",
  "near_front",
  "near_back",
  "same_row",
  "near_first_choice",
]);

const MAX_CANDIDATES = 30;
const MAX_PICKS = 3;

function distanceScore(candidate: SeatCandidate): number {
  return candidate.rowsFromFirstChoice * 1000 + candidate.seatsFromFirstChoice;
}

function blockAnchor(seats: Seat[], seatIds: string[]): Seat | null {
  const chosen = seatIds
    .map((id) => seats.find((seat) => seat.id === id))
    .filter((seat): seat is Seat => seat !== undefined)
    .sort((a, b) => a.position - b.position);
  return chosen[0] ?? null;
}

function hasMapNeighbor(
  seat: Seat,
  seats: Seat[],
  delta: -1 | 1,
): boolean {
  return seats.some(
    (other) =>
      other.showbuyId === seat.showbuyId &&
      other.row === seat.row &&
      other.position === seat.position + delta,
  );
}

function factsForBlock(
  seats: Seat[],
  seatIds: string[],
  firstChoiceSeatIds: string[],
  maxGridRow: number,
): SeatFact[] {
  const anchor = blockAnchor(seats, seatIds);
  if (!anchor) return [];

  const firstAnchors = firstChoiceSeatIds
    .map((id) => seats.find((seat) => seat.id === id))
    .filter((seat): seat is Seat => seat !== undefined);
  const first = firstAnchors[0];

  const facts: SeatFact[] = [];
  const left = hasMapNeighbor(anchor, seats, -1);
  const right = hasMapNeighbor(
    seats.find((s) => s.id === seatIds[seatIds.length - 1]!) ?? anchor,
    seats,
    1,
  );
  if (!left || !right) facts.push("aisle");

  const rowSeats = seats.filter(
    (seat) => seat.showbuyId === anchor.showbuyId && seat.row === anchor.row,
  );
  const minPos = Math.min(...rowSeats.map((seat) => seat.position));
  const maxPos = Math.max(...rowSeats.map((seat) => seat.position));
  const mid = (minPos + maxPos) / 2;
  if (Math.abs(anchor.position - mid) <= 1) facts.push("center");

  if (anchor.gridRow <= 2) facts.push("near_front");
  if (maxGridRow > 0 && anchor.gridRow >= maxGridRow - 1) facts.push("near_back");

  if (first && anchor.row === first.row) facts.push("same_row");

  if (first) {
    const dist =
      Math.abs(anchor.gridRow - first.gridRow) * 1000 +
      Math.abs(anchor.position - first.position);
    if (dist <= 2002) facts.push("near_first_choice");
  }

  return facts;
}

function findContiguousBlocks(
  seats: Seat[],
  preferredSectionIds: readonly string[],
  qty: number,
  scope: SaleScope | undefined,
): string[][] {
  const allowed = new Set(preferredSectionIds);
  const holdable = seats
    .filter((seat) => allowed.has(seat.sectionId) && canHold(seat, scope))
    .sort((a, b) => a.gridRow - b.gridRow || a.position - b.position);

  const byRow = new Map<string, Seat[]>();
  for (const seat of holdable) {
    const key = `${seat.gridRow}:${seat.row}`;
    const list = byRow.get(key) ?? [];
    list.push(seat);
    byRow.set(key, list);
  }

  const blocks: string[][] = [];
  for (const rowSeats of byRow.values()) {
    rowSeats.sort((a, b) => a.position - b.position);
    for (let i = 0; i <= rowSeats.length - qty; i++) {
      const slice = rowSeats.slice(i, i + qty);
      let contiguous = true;
      for (let j = 1; j < slice.length; j++) {
        if (slice[j]!.position !== slice[j - 1]!.position + 1) {
          contiguous = false;
          break;
        }
      }
      if (contiguous) blocks.push(slice.map((seat) => seat.id));
    }
  }
  return blocks;
}

export function buildSeatCandidates(input: {
  seats: Seat[];
  preferredSectionId: string;
  /** Same-price sections collapsed for the customer (e.g. Heart L/R). */
  preferredSectionIds?: readonly string[];
  qty: number;
  firstChoiceSeatIds: string[];
  requiresSingle: boolean;
  scope?: SaleScope;
}): SeatCandidate[] {
  const { seats, preferredSectionId, qty, firstChoiceSeatIds, requiresSingle, scope } =
    input;
  if (qty < 1) return [];

  const preferredSectionIds =
    input.preferredSectionIds && input.preferredSectionIds.length > 0
      ? input.preferredSectionIds
      : [preferredSectionId];

  const maxGridRow = seats.reduce((max, seat) => Math.max(max, seat.gridRow), 0);
  const firstAnchors = firstChoiceSeatIds
    .map((id) => seats.find((seat) => seat.id === id))
    .filter((seat): seat is Seat => seat !== undefined);
  const first = firstAnchors[0];

  let blocks = findContiguousBlocks(seats, preferredSectionIds, qty, scope);

  if (requiresSingle) {
    if (qty !== 1) return [];
    blocks = blocks.filter((block) => {
      const id = block[0]!;
      return checkSingle(id, seats, scope).ok;
    });
  }

  const scored = blocks.map((seatIds, index) => {
    const anchor = blockAnchor(seats, seatIds)!;
    const rowsFromFirstChoice = first
      ? Math.abs(anchor.gridRow - first.gridRow)
      : anchor.gridRow;
    const seatsFromFirstChoice = first
      ? Math.abs(anchor.position - first.position)
      : anchor.position;
    const candidate: SeatCandidate = {
      id: `opt_${index + 1}`,
      seatIds,
      rowsFromFront: anchor.gridRow,
      rowsFromFirstChoice,
      seatsFromFirstChoice,
      facts: factsForBlock(seats, seatIds, firstChoiceSeatIds, maxGridRow),
    };
    return candidate;
  });

  scored.sort((a, b) => distanceScore(a) - distanceScore(b));
  return scored.slice(0, MAX_CANDIDATES).map((candidate, index) => ({
    ...candidate,
    id: `opt_${index + 1}`,
  }));
}

export function sanitizeSeatPicks(
  raw: SeatPicks,
  candidates: SeatCandidate[],
): SeatPicks {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const picks: SeatPicks["picks"] = [];

  for (const pick of raw.picks) {
    if (seen.has(pick.id)) continue;
    const candidate = byId.get(pick.id);
    if (!candidate) continue;
    const allowed = new Set(candidate.facts);
    const matchedFacts = pick.matchedFacts.filter(
      (fact) => ALL_FACTS.has(fact) && allowed.has(fact),
    );
    seen.add(pick.id);
    picks.push({ id: pick.id, matchedFacts });
    if (picks.length >= MAX_PICKS) break;
  }

  return {
    picks,
    hasUncheckableRequest: Boolean(raw.hasUncheckableRequest),
  };
}

export function fallbackSeatPicks(candidates: SeatCandidate[]): SeatPicks {
  return {
    picks: candidates.slice(0, MAX_PICKS).map((candidate) => ({
      id: candidate.id,
      matchedFacts: [...candidate.facts],
    })),
    hasUncheckableRequest: false,
  };
}

export function reasonLineForPick(
  pick: { id: string; matchedFacts: SeatFact[] },
  candidates: SeatCandidate[],
): string {
  const candidate = candidates.find((item) => item.id === pick.id);
  if (!candidate) return "";
  const facts = pick.matchedFacts.length > 0 ? pick.matchedFacts : candidate.facts;
  if (facts.length === 0) return `Seats ${candidate.seatIds.join(", ")}`;
  return facts.join(", ");
}
