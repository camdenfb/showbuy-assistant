import { describe, expect, test } from "vitest";
import { canHold, customerOffer } from "./seats";
import {
  mapT2mFeed,
  parseSeatLabel,
  ticketTypesFromCells,
  validateT2mWire,
  type T2mWireResponse,
} from "./import-map";

function wire(
  attributes: T2mWireResponse["data"]["attributes"],
  success = true,
): T2mWireResponse {
  return { success, status: success ? "ok" : "error", data: { attributes } };
}

const row = (
  rowNumber: number,
  seats: T2mWireResponse["data"]["attributes"][number]["seats"],
) => ({ rowNumber, seats });

describe("Ticket2Me seat map import rules", () => {
  test("AC26: fictional plan keeps gaps and leaves unavailable seats as house until marked", () => {
    const parsed = validateT2mWire(
      wire([
        row(1, [
          { ticket_id: 101, seat_id: 1, seat_no: "C1", status: 0 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 101, seat_id: 2, seat_no: "C2", status: -1 },
          { ticket_id: 101, seat_id: 3, seat_no: "C3", status: 2 },
        ]),
        row(2, [
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
        ]),
        row(3, [
          { ticket_id: 102, seat_id: 4, seat_no: "B1", status: -1 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 102, seat_id: 5, seat_no: "B3", status: 0 },
          { ticket_id: 102, seat_id: 6, seat_no: "B4", status: -1 },
        ]),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const mapped = mapT2mFeed({
      feed: parsed.feed,
      showbuyId: "show-1",
      sectionByTicketType: { 101: "sec-a", 102: "sec-b" },
      classifications: {},
      regularPriceBySection: { "sec-a": 500_000, "sec-b": 300_000 },
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    const c2 = mapped.seats.find((s) => s.label === "C2");
    const c1 = mapped.seats.find((s) => s.label === "C1");
    const c3 = mapped.seats.find((s) => s.label === "C3");
    expect(c2?.status).toBe("house");
    expect(c2?.position).toBe(2);
    expect(c1?.position).toBe(0);
    expect(c3?.status).toBe("sold_t2m");
    expect(mapped.seats.some((s) => s.label === "EMPTY")).toBe(false);
    expect(canHold(c2!)).toBe(false);
    expect(customerOffer(c2!)).toBe("unavailable");
  });

  test("AC12: an imported on-sale seat offers Ticket2Me and cannot be held", () => {
    const parsed = validateT2mWire(
      wire([
        row(1, [{ ticket_id: 101, seat_id: 1, seat_no: "C5", status: 0 }]),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const mapped = mapT2mFeed({
      feed: parsed.feed,
      showbuyId: "show-1",
      sectionByTicketType: { 101: "sec-a" },
      classifications: {},
      regularPriceBySection: { "sec-a": 500_000 },
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const seat = mapped.seats[0]!;
    expect(seat.status).toBe("available_t2m");
    expect(customerOffer(seat)).toBe("ticket2me");
    expect(canHold(seat)).toBe(false);
  });

  test("rejects success=false, empty feed, unequal widths, duplicate rows/labels, blank and bad labels, unknown status", () => {
    expect(validateT2mWire(wire([], false)).ok).toBe(false);
    expect(validateT2mWire(wire([])).ok).toBe(false);
    expect(
      validateT2mWire(
        wire([
          row(1, [
            { ticket_id: 1, seat_id: 1, seat_no: "C1", status: 0 },
            { ticket_id: 1, seat_id: 2, seat_no: "C2", status: 0 },
          ]),
          row(2, [{ ticket_id: 1, seat_id: 3, seat_no: "C3", status: 0 }]),
        ]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([
          row(1, [{ ticket_id: 1, seat_id: 1, seat_no: "C1", status: 0 }]),
          row(1, [{ ticket_id: 1, seat_id: 2, seat_no: "C2", status: 0 }]),
        ]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([
          row(1, [
            { ticket_id: 1, seat_id: 1, seat_no: "C1", status: 0 },
            { ticket_id: 1, seat_id: 2, seat_no: "C1", status: 0 },
          ]),
        ]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([row(1, [{ ticket_id: 1, seat_id: 1, seat_no: "", status: 0 }])]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([row(1, [{ ticket_id: 1, seat_id: 1, seat_no: "12C", status: 0 }])]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([row(1, [{ ticket_id: 1, seat_id: 1, seat_no: "C1", status: 9 as 0 }])]),
      ).ok,
    ).toBe(false);
    expect(
      validateT2mWire(
        wire([
          row(1, [
            { ticket_id: 1, seat_id: 1, seat_no: "C1", status: 0 },
            { ticket_id: 1, seat_id: 1, seat_no: "C2", status: 0 },
          ]),
        ]),
      ).ok,
    ).toBe(false);
  });

  test("parseSeatLabel splits C12 and ticket types ignore EMPTY", () => {
    expect(parseSeatLabel("C12")).toEqual({ row: "C", number: 12 });
    expect(parseSeatLabel("EMPTY")).toBeNull();
    const parsed = validateT2mWire(
      wire([
        row(1, [
          { ticket_id: 101, seat_id: 1, seat_no: "C1", status: 0 },
          { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
          { ticket_id: 102, seat_id: 2, seat_no: "C3", status: -1 },
        ]),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(ticketTypesFromCells(parsed.feed)).toEqual([101, 102]);
  });

  test("classifications mark unavailable seats; stale non-unavailable classification fails the map", () => {
    const parsed = validateT2mWire(
      wire([
        row(1, [
          { ticket_id: 101, seat_id: 1, seat_no: "C1", status: -1 },
          { ticket_id: 101, seat_id: 2, seat_no: "C2", status: 0 },
        ]),
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const ok = mapT2mFeed({
      feed: parsed.feed,
      showbuyId: "show-1",
      sectionByTicketType: { 101: "sec-a" },
      classifications: { 1: "direct_buy" },
      regularPriceBySection: { "sec-a": 500_000 },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.seats.find((s) => s.label === "C1")?.status).toBe("direct_buy");
    }

    const stale = mapT2mFeed({
      feed: parsed.feed,
      showbuyId: "show-1",
      sectionByTicketType: { 101: "sec-a" },
      classifications: { 2: "house" },
      regularPriceBySection: { "sec-a": 500_000 },
    });
    expect(stale.ok).toBe(false);
  });
});
