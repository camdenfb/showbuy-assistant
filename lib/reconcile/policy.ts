import type { T2mFeedRow } from "../rules/import-map";
import type { SyncReading, T2mStatus } from "../rules/seats";

export function shouldReconcileShowbuy(input: {
  startsAt: string;
  lastSyncedAt: string | null;
  syncIntervalMinutes: number;
  nowMs: number;
  force?: boolean;
}): boolean {
  const startsMs = Date.parse(input.startsAt);
  if (!Number.isFinite(startsMs) || startsMs <= input.nowMs) return false;

  if (input.force) return true;

  if (!input.lastSyncedAt) return true;
  const lastMs = Date.parse(input.lastSyncedAt);
  if (!Number.isFinite(lastMs)) return true;

  const intervalMs = Math.max(1, input.syncIntervalMinutes) * 60_000;
  return input.nowMs - lastMs >= intervalMs;
}

export function t2mWireToStatus(status: number): T2mStatus {
  // Ticket2Me: 0 = on sale; 2 = sold there; -1 = unavailable (we may sell direct).
  if (status === 0) return "available";
  if (status === 2) return "sold";
  if (status === -1) return "unavailable";
  return "unknown";
}

export function buildSyncReadingFromFeed(input: {
  seats: readonly { id: string; t2mSeatId: number }[];
  feed: readonly T2mFeedRow[];
}): SyncReading {
  const byT2mId = new Map<number, T2mStatus>();
  for (const row of input.feed) {
    for (const cell of row.seats) {
      if (cell.seat_no === "EMPTY") continue;
      byT2mId.set(cell.seat_id, t2mWireToStatus(cell.status));
    }
  }

  const bySeatId: Record<string, T2mStatus> = {};
  for (const seat of input.seats) {
    const status = byT2mId.get(seat.t2mSeatId);
    if (status === undefined) {
      return { ok: false };
    }
    bySeatId[seat.id] = status;
  }

  return { ok: true, bySeatId };
}
