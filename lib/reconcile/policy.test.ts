import { describe, expect, test } from "vitest";
import {
  buildSyncReadingFromFeed,
  shouldReconcileShowbuy,
  t2mWireToStatus,
} from "./policy";

describe("shouldReconcileShowbuy", () => {
  const now = Date.parse("2026-11-22T12:00:00.000Z");

  test("skips showbuys that already started", () => {
    expect(
      shouldReconcileShowbuy({
        startsAt: "2026-11-22T11:00:00.000Z",
        lastSyncedAt: null,
        syncIntervalMinutes: 60,
        nowMs: now,
      }),
    ).toBe(false);
  });

  test("runs when never synced", () => {
    expect(
      shouldReconcileShowbuy({
        startsAt: "2027-01-01T00:00:00.000Z",
        lastSyncedAt: null,
        syncIntervalMinutes: 60,
        nowMs: now,
      }),
    ).toBe(true);
  });

  test("skips when inside interval", () => {
    expect(
      shouldReconcileShowbuy({
        startsAt: "2027-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-11-22T11:30:00.000Z",
        syncIntervalMinutes: 60,
        nowMs: now,
      }),
    ).toBe(false);
  });

  test("runs when interval elapsed", () => {
    expect(
      shouldReconcileShowbuy({
        startsAt: "2027-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-11-22T10:00:00.000Z",
        syncIntervalMinutes: 60,
        nowMs: now,
      }),
    ).toBe(true);
  });

  test("force ignores interval but not past startsAt", () => {
    expect(
      shouldReconcileShowbuy({
        startsAt: "2027-01-01T00:00:00.000Z",
        lastSyncedAt: "2026-11-22T11:59:00.000Z",
        syncIntervalMinutes: 60,
        nowMs: now,
        force: true,
      }),
    ).toBe(true);
    expect(
      shouldReconcileShowbuy({
        startsAt: "2026-11-22T11:00:00.000Z",
        lastSyncedAt: null,
        syncIntervalMinutes: 60,
        nowMs: now,
        force: true,
      }),
    ).toBe(false);
  });
});

describe("feed reading", () => {
  test("maps wire statuses", () => {
    expect(t2mWireToStatus(0)).toBe("available");
    expect(t2mWireToStatus(2)).toBe("sold");
    expect(t2mWireToStatus(-1)).toBe("unavailable");
    expect(t2mWireToStatus(9)).toBe("unknown");
  });

  test("buildSyncReadingFromFeed keys by local seat id", () => {
    const reading = buildSyncReadingFromFeed({
      seats: [
        { id: "local-a", t2mSeatId: 10 },
        { id: "local-b", t2mSeatId: 11 },
      ],
      feed: [
        {
          rowNumber: 1,
          seats: [
            { ticket_id: 1, seat_id: 10, seat_no: "A1", status: 0 },
            { ticket_id: 1, seat_id: 11, seat_no: "A2", status: -1 },
            { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          ],
        },
      ],
    });
    expect(reading).toEqual({
      ok: true,
      bySeatId: {
        "local-a": "available",
        "local-b": "unavailable",
      },
    });
  });

  test("missing feed seats make reading incomplete (ok false)", () => {
    const reading = buildSyncReadingFromFeed({
      seats: [
        { id: "local-a", t2mSeatId: 10 },
        { id: "local-missing", t2mSeatId: 99 },
      ],
      feed: [
        {
          rowNumber: 1,
          seats: [{ ticket_id: 1, seat_id: 10, seat_no: "A1", status: 0 }],
        },
      ],
    });
    expect(reading.ok).toBe(false);
  });
});
