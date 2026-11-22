export type SeatStatus =
  | "house"
  | "available_t2m"
  | "pullout_pending"
  | "direct_buy"
  | "on_hold"
  | "sold_t2m"
  | "sold_direct";

export type T2mStatus = "available" | "unavailable" | "sold" | "unknown";

export type Seat = {
  id: string;
  showbuyId: string;
  sectionId: string;
  row: string;
  number: number;
  label: string;
  gridRow: number;
  position: number;
  status: SeatStatus;
  t2mStatus: T2mStatus;
  conflict: string | null;
};

export type SyncReading =
  | { ok: false }
  | { ok: true; bySeatId: Record<string, T2mStatus> };

export type SaleScope = {
  coverage: "full" | "partial";
  sectionIds: readonly string[];
};

const FULL_SCOPE: SaleScope = { coverage: "full", sectionIds: [] };

const SEAT_STATUSES: SeatStatus[] = [
  "house",
  "available_t2m",
  "pullout_pending",
  "direct_buy",
  "on_hold",
  "sold_t2m",
  "sold_direct",
];

export function seatInScope(seat: Seat, scope: SaleScope = FULL_SCOPE): boolean {
  return scope.coverage === "full" || scope.sectionIds.includes(seat.sectionId);
}

const T2M_STATUSES = new Set<T2mStatus>([
  "available",
  "unavailable",
  "sold",
  "unknown",
]);

export function canHold(seat: Seat, scope: SaleScope = FULL_SCOPE): boolean {
  return (
    seatInScope(seat, scope) && seat.status === "direct_buy" && seat.conflict === null
  );
}

export function customerOffer(
  seat: Seat,
  scope: SaleScope = FULL_SCOPE,
): "direct_buy" | "ticket2me" | "unavailable" {
  if (!seatInScope(seat, scope)) return "unavailable";
  if (canHold(seat, scope)) return "direct_buy";
  if (seat.status === "available_t2m" && seat.conflict === null) return "ticket2me";
  return "unavailable";
}

function withHold(seats: Seat[], ids: string[], scope: SaleScope): Seat[] | null {
  if (ids.length === 0) return null;
  const wanted = new Set(ids);
  const chosen = seats.filter((seat) => wanted.has(seat.id));
  if (chosen.length !== wanted.size) return null;
  if (!chosen.every((seat) => canHold(seat, scope))) return null;
  return seats.map((seat) =>
    wanted.has(seat.id) ? { ...seat, status: "on_hold" } : seat,
  );
}

export function holdChoices(
  seats: Seat[],
  firstChoice: string[],
  secondChoice: string[],
  scope: SaleScope = FULL_SCOPE,
): { seats: Seat[]; heldSeatIds: string[] } {
  const firstHeld = withHold(seats, firstChoice, scope);
  if (firstHeld) return { seats: firstHeld, heldSeatIds: [...firstChoice] };

  // Any first-choice seat that cannot be held (taken, conflict, unsellable) → try second.
  const secondHeld = withHold(seats, secondChoice, scope);
  if (!secondHeld) return { seats, heldSeatIds: [] };
  return { seats: secondHeld, heldSeatIds: [...secondChoice] };
}

export function resolveConcurrentHolds(
  seats: Seat[],
  requests: { customerId: string; seatIds: string[] }[],
): {
  seats: Seat[];
  holds: { customerId: string; heldSeatIds: string[] }[];
} {
  let current = seats;
  const holds = requests.map((request) => {
    const next = withHold(current, request.seatIds, FULL_SCOPE);
    if (!next) return { customerId: request.customerId, heldSeatIds: [] };
    current = next;
    return { customerId: request.customerId, heldSeatIds: [...request.seatIds] };
  });
  return { seats: current, holds };
}

function applyReading(seat: Seat, t2mStatus: T2mStatus): Seat {
  const next: Seat = { ...seat, t2mStatus };
  if (t2mStatus === "unknown") return { ...next, conflict: "t2m_unknown" };

  switch (seat.status) {
    case "house":
      return t2mStatus === "unavailable"
        ? { ...next, conflict: null }
        : { ...next, conflict: "t2m_mismatch" };
    case "available_t2m":
      if (t2mStatus === "sold") return { ...next, status: "sold_t2m", conflict: null };
      if (t2mStatus === "unavailable") return { ...next, conflict: "needs_review" };
      return { ...next, conflict: null };
    case "pullout_pending":
      if (t2mStatus === "sold") return { ...next, status: "sold_t2m", conflict: null };
      return { ...next, conflict: null };
    case "direct_buy":
    case "on_hold":
    case "sold_direct":
      return t2mStatus === "unavailable"
        ? { ...next, conflict: null }
        : { ...next, conflict: "t2m_mismatch" };
    case "sold_t2m":
      if (t2mStatus === "available") {
        return { ...next, status: "available_t2m", conflict: null };
      }
      if (t2mStatus === "sold") return { ...next, conflict: null };
      return { ...next, conflict: "t2m_mismatch" };
    default:
      return { ...next, conflict: "t2m_unknown" };
  }
}

export function reconcileShowbuy(
  seats: Seat[],
  reading: SyncReading,
): { seats: Seat[]; ordersPaused: boolean } {
  if (!reading.ok) return { seats, ordersPaused: true };

  const complete = seats.every((seat) => {
    const status = reading.bySeatId[seat.id];
    return status !== undefined && T2M_STATUSES.has(status);
  });
  if (!complete) return { seats, ordersPaused: true };

  return {
    ordersPaused: false,
    seats: seats.map((seat) => applyReading(seat, reading.bySeatId[seat.id]!)),
  };
}

export function confirmPullout(seat: Seat): Seat {
  if (seat.status !== "pullout_pending" || seat.t2mStatus !== "unavailable") {
    return seat;
  }
  return { ...seat, status: "direct_buy", conflict: null };
}

function hasAvailableNeighbor(seat: Seat, seats: Seat[]): boolean {
  return seats.some(
    (other) =>
      other.id !== seat.id &&
      other.showbuyId === seat.showbuyId &&
      other.row === seat.row &&
      Math.abs(other.position - seat.position) === 1 &&
      (canHold(other) ||
        (other.status === "available_t2m" && other.conflict === null)),
  );
}

export function checkSingle(
  seatId: string,
  seats: Seat[],
  scope: SaleScope = FULL_SCOPE,
): { ok: true } | { ok: false; suggestions: string[] } {
  const chosen = seats.find((seat) => seat.id === seatId);
  if (!chosen) return { ok: false, suggestions: [] };
  if (!hasAvailableNeighbor(chosen, seats)) return { ok: true };

  const distance = (seat: Seat) =>
    Math.abs(seat.gridRow - chosen.gridRow) * 1000 +
    Math.abs(seat.position - chosen.position);

  const suggestions = seats
    .filter(
      (seat) =>
        seat.id !== chosen.id &&
        seat.showbuyId === chosen.showbuyId &&
        canHold(seat, scope) &&
        !hasAvailableNeighbor(seat, seats),
    )
    .sort((left, right) => distance(left) - distance(right))
    .map((seat) => seat.id);

  return { ok: false, suggestions };
}

function releaseSeat(seat: Seat): Seat {
  if (seat.t2mStatus === "unavailable") {
    return { ...seat, status: "direct_buy", conflict: null };
  }
  if (seat.t2mStatus === "available") {
    return { ...seat, status: "available_t2m", conflict: null };
  }
  if (seat.t2mStatus === "sold") {
    return { ...seat, status: "sold_t2m", conflict: null };
  }
  return { ...seat, status: "direct_buy", conflict: "t2m_unknown" };
}

export function releaseHeldSeats(seats: Seat[], heldSeatIds: string[]): Seat[] {
  const ids = new Set(heldSeatIds);
  return seats.map((seat) => (ids.has(seat.id) ? releaseSeat(seat) : seat));
}

export function markSoldDirect(seats: Seat[], heldSeatIds: string[]): Seat[] {
  const ids = new Set(heldSeatIds);
  return seats.map((seat) =>
    ids.has(seat.id) ? { ...seat, status: "sold_direct" } : seat,
  );
}

export function moveHold(
  seats: Seat[],
  fromSeatIds: string[],
  toSeatIds: string[],
  claimCodeSent: boolean,
  scope: SaleScope = FULL_SCOPE,
): { ok: boolean; seats: Seat[] } {
  if (claimCodeSent || fromSeatIds.length === 0) return { ok: false, seats };

  const from = fromSeatIds.map((id) => seats.find((seat) => seat.id === id));
  if (
    from.some(
      (seat) =>
        seat === undefined ||
        (seat.status !== "on_hold" && seat.status !== "sold_direct"),
    )
  ) {
    return { ok: false, seats };
  }

  const wasSoldDirect = from.every((seat) => seat!.status === "sold_direct");
  const released = seats.map((seat) =>
    fromSeatIds.includes(seat.id) ? releaseSeat(seat) : seat,
  );
  const held = withHold(released, toSeatIds, scope);
  if (!held) return { ok: false, seats };
  return {
    ok: true,
    seats: wasSoldDirect ? markSoldDirect(held, toSeatIds) : held,
  };
}

export function inventorySummary(
  seats: Seat[],
  scope: SaleScope = FULL_SCOPE,
): {
  counts: Record<SeatStatus, number>;
  percentSold: number | null;
  percentUnsold: number | null;
} {
  const counts = Object.fromEntries(
    SEAT_STATUSES.map((status) => [status, 0]),
  ) as Record<SeatStatus, number>;

  for (const seat of seats) {
    if (seatInScope(seat, scope)) counts[seat.status] += 1;
  }

  const sold = counts.sold_direct + counts.sold_t2m;
  const unsold =
    counts.available_t2m + counts.pullout_pending + counts.direct_buy + counts.on_hold;
  const counted = sold + unsold;

  if (counted === 0) {
    return { counts, percentSold: null, percentUnsold: null };
  }

  return {
    counts,
    percentSold: (sold / counted) * 100,
    percentUnsold: (unsold / counted) * 100,
  };
}

export function seatFromImport(input: {
  id: string;
  showbuyId: string;
  sectionId: string;
  row: string;
  number: number;
  label: string;
  gridRow: number;
  position: number;
  t2mStatus: T2mStatus;
}): Seat {
  const status: SeatStatus =
    input.t2mStatus === "available"
      ? "available_t2m"
      : input.t2mStatus === "sold"
        ? "sold_t2m"
        : "house";

  return {
    ...input,
    status,
    conflict: input.t2mStatus === "unknown" ? "t2m_unknown" : null,
  };
}
