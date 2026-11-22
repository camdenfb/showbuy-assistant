import { describe, expect, test } from "vitest";
import {
  canHold,
  checkSingle,
  confirmPullout,
  customerOffer,
  holdChoices,
  inventorySummary,
  moveHold,
  reconcileShowbuy,
  resolveConcurrentHolds,
  seatFromImport,
  type SaleScope,
  type Seat,
} from "./seats";

function seat(overrides: Partial<Seat> & Pick<Seat, "id">): Seat {
  return {
    showbuyId: "show-1",
    sectionId: "sec-a",
    row: "C",
    number: 5,
    label: "C5",
    gridRow: 3,
    position: 5,
    status: "direct_buy",
    t2mStatus: "unavailable",
    conflict: null,
    ...overrides,
  };
}

describe("seat rules", () => {
  test("AC1: holding C5 in one showbuy leaves C5 in the other unchanged", () => {
    const showA = seat({
      id: "show-a-c5",
      showbuyId: "show-a",
      label: "C5",
      row: "C",
      number: 5,
    });
    const showB = seat({
      id: "show-b-c5",
      showbuyId: "show-b",
      label: "C5",
      row: "C",
      number: 5,
    });

    const result = holdChoices([showA, showB], ["show-a-c5"], ["show-b-c5"]);

    expect(result.heldSeatIds).toEqual(["show-a-c5"]);
    expect(result.seats.find((item) => item.id === "show-a-c5")?.status).toBe(
      "on_hold",
    );
    expect(result.seats.find((item) => item.id === "show-b-c5")).toEqual(showB);
  });

  test("AC2: a direct-buy seat Ticket2Me shows as unavailable stays available with no conflict", () => {
    const before = seat({ id: "c5", status: "direct_buy", t2mStatus: "available" });

    const result = reconcileShowbuy([before], {
      ok: true,
      bySeatId: { c5: "unavailable" },
    });
    const after = result.seats[0];

    expect(result.ordersPaused).toBe(false);
    expect(after?.status).toBe("direct_buy");
    expect(after?.conflict).toBeNull();
    expect(after && canHold(after)).toBe(true);
    expect(after && customerOffer(after)).toBe("direct_buy");
  });

  test("AC3: a direct-buy seat back on sale is a conflict and cannot be held", () => {
    const before = seat({
      id: "c5",
      status: "direct_buy",
      t2mStatus: "unavailable",
    });

    const result = reconcileShowbuy([before], {
      ok: true,
      bySeatId: { c5: "available" },
    });
    const after = result.seats[0];

    expect(after?.status).toBe("direct_buy");
    expect(after?.conflict).not.toBeNull();
    expect(after && canHold(after)).toBe(false);
    expect(holdChoices(result.seats, ["c5"], []).heldSeatIds).toEqual([]);
  });

  test("AC4: an unavailable pending pull-out stays pending until the showbuyer confirms", () => {
    const before = seat({
      id: "c5",
      status: "pullout_pending",
      t2mStatus: "available",
    });

    const result = reconcileShowbuy([before], {
      ok: true,
      bySeatId: { c5: "unavailable" },
    });
    const after = result.seats[0];

    expect(after?.status).toBe("pullout_pending");
    expect(after && canHold(after)).toBe(false);
    expect(after && confirmPullout(after).status).toBe("direct_buy");
  });

  test("AC5: a failed or malformed Ticket2Me reading changes no seats and pauses that showbuy only", () => {
    const showA = [
      seat({ id: "a-c5", showbuyId: "show-a", status: "direct_buy" }),
    ];
    const showB = [
      seat({ id: "b-c5", showbuyId: "show-b", status: "house", t2mStatus: "unavailable" }),
    ];

    const failed = reconcileShowbuy(showA, { ok: false });
    const malformed = reconcileShowbuy(showA, { ok: true, bySeatId: {} });
    const other = reconcileShowbuy(showB, {
      ok: true,
      bySeatId: { "b-c5": "unavailable" },
    });

    expect(failed.ordersPaused).toBe(true);
    expect(failed.seats).toEqual(showA);
    expect(showA[0]?.status).toBe("direct_buy");
    expect(malformed.ordersPaused).toBe(true);
    expect(malformed.seats).toEqual(showA);
    expect(other.ordersPaused).toBe(false);
    expect(other.seats[0]?.status).toBe("house");
    expect(other.seats[0]?.conflict).toBeNull();
  });

  test("AC6: two customers submitting the same free seat produce exactly one hold", () => {
    const free = seat({ id: "c5", status: "direct_buy" });

    const result = resolveConcurrentHolds(
      [free],
      [
        { customerId: "ava", seatIds: ["c5"] },
        { customerId: "ben", seatIds: ["c5"] },
      ],
    );
    const winners = result.holds.filter((hold) => hold.heldSeatIds.length > 0);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.heldSeatIds).toEqual(["c5"]);
    expect(result.seats.filter((item) => item.status === "on_hold")).toHaveLength(1);
    expect(result.holds.find((hold) => hold.customerId === "ben")?.heldSeatIds).toEqual(
      [],
    );
  });

  test("AC7: when the first choice is on hold, only the second choice is held", () => {
    const first = seat({ id: "c5", status: "on_hold" });
    const second = seat({ id: "c6", number: 6, label: "C6", position: 6 });

    const result = holdChoices([first, second], ["c5"], ["c6"]);

    expect(result.heldSeatIds).toEqual(["c6"]);
    expect(result.seats.find((item) => item.id === "c5")?.status).toBe("on_hold");
    expect(result.seats.find((item) => item.id === "c6")?.status).toBe("on_hold");
  });

  test("AC8: when both choices are taken, no hold is created and no seat changes", () => {
    const first = seat({ id: "c5", status: "sold_direct" });
    const second = seat({ id: "c6", number: 6, label: "C6", status: "on_hold" });

    const result = holdChoices([first, second], ["c5"], ["c6"]);

    expect(result.heldSeatIds).toEqual([]);
    expect(result.seats).toEqual([first, second]);
    expect(first.status).toBe("sold_direct");
    expect(second.status).toBe("on_hold");
  });

  test("AC9: SINGLE rejects a seat with an available neighbor and suggests nearer qualifying seats first", () => {
    const chosen = seat({ id: "c2", number: 2, label: "C2", position: 2 });
    const neighbor = seat({
      id: "c3",
      number: 3,
      label: "C3",
      position: 3,
      status: "available_t2m",
      t2mStatus: "available",
    });
    const nearer = seat({ id: "c6", number: 6, label: "C6", position: 6 });
    const farther = seat({ id: "c10", number: 10, label: "C10", position: 10 });

    const result = checkSingle("c2", [chosen, neighbor, nearer, farther]);

    expect(result).toEqual({ ok: false, suggestions: ["c6", "c10"] });
  });

  test("AC12: a seat still on sale links to Ticket2Me and creates no hold", () => {
    const onSale = seat({
      id: "c5",
      status: "available_t2m",
      t2mStatus: "available",
    });

    expect(customerOffer(onSale)).toBe("ticket2me");
    expect(canHold(onSale)).toBe(false);
    expect(holdChoices([onSale], ["c5"], ["c6"]).heldSeatIds).toEqual([]);
    expect(onSale.status).toBe("available_t2m");
  });

  test("AC26: an imported unavailable seat keeps its place and is not offered for direct buy", () => {
    const imported = seatFromImport({
      id: "c5",
      showbuyId: "show-1",
      sectionId: "sec-a",
      row: "C",
      number: 5,
      label: "C5",
      gridRow: 2,
      position: 4,
      t2mStatus: "unavailable",
    });
    const onSale = seatFromImport({
      id: "c6",
      showbuyId: "show-1",
      sectionId: "sec-a",
      row: "C",
      number: 6,
      label: "C6",
      gridRow: 2,
      position: 6,
      t2mStatus: "available",
    });

    expect(imported.row).toBe("C");
    expect(imported.number).toBe(5);
    expect(imported.label).toBe("C5");
    expect(imported.gridRow).toBe(2);
    expect(imported.position).toBe(4);
    expect(canHold(imported)).toBe(false);
    expect(customerOffer(imported)).toBe("unavailable");
    expect(onSale.status).toBe("available_t2m");
    expect(customerOffer(onSale)).toBe("ticket2me");
  });

  test("AC27: a successful move holds the new seat and releases the old one, and a failed move changes nothing", () => {
    const held = seat({ id: "c5", status: "on_hold" });
    const next = seat({ id: "c8", number: 8, label: "C8", position: 8, status: "direct_buy" });
    const blocked = seat({ id: "c9", number: 9, label: "C9", position: 9, status: "on_hold" });

    const moved = moveHold([held, next], ["c5"], ["c8"], false);
    const failed = moveHold([held, blocked], ["c5"], ["c9"], false);
    const afterClaim = moveHold([held, next], ["c5"], ["c8"], true);

    expect(moved.ok).toBe(true);
    expect(moved.seats.find((item) => item.id === "c8")?.status).toBe("on_hold");
    expect(moved.seats.find((item) => item.id === "c5")?.status).toBe("direct_buy");
    expect(failed.ok).toBe(false);
    expect(failed.seats).toEqual([held, blocked]);
    expect(held.status).toBe("on_hold");
    expect(blocked.status).toBe("on_hold");
    expect(afterClaim.ok).toBe(false);
    expect(afterClaim.seats).toEqual([held, next]);
  });

  test("a choice holds every seat or none, and does not fall through when a seat is unsellable", () => {
    const free = seat({ id: "c5", position: 5 });
    const taken = seat({ id: "c6", number: 6, label: "C6", position: 6, status: "on_hold" });
    const backup = seat({ id: "c8", number: 8, label: "C8", position: 8 });
    const onSale = seat({
      id: "d1",
      row: "D",
      number: 1,
      label: "D1",
      position: 1,
      status: "available_t2m",
      t2mStatus: "available",
    });

    const partial = holdChoices([free, taken, backup], ["c5", "c6"], ["c8"]);
    const unsellable = holdChoices([onSale, backup], ["d1"], ["c8"]);

    expect(partial.heldSeatIds).toEqual([]);
    expect(partial.seats.find((item) => item.id === "c5")?.status).toBe("direct_buy");
    expect(unsellable.heldSeatIds).toEqual([]);
    expect(unsellable.seats.find((item) => item.id === "c8")?.status).toBe("direct_buy");
  });

  test("SINGLE ignores an aisle gap and does not treat an on-hold neighbor as available", () => {
    const left = seat({ id: "c1", number: 1, label: "C1", position: 1 });
    const acrossAisle = seat({ id: "c3", number: 3, label: "C3", position: 3 });
    const besideHold = seat({ id: "c4", number: 4, label: "C4", position: 4, status: "on_hold" });

    expect(checkSingle("c1", [left, acrossAisle])).toEqual({ ok: true });
    expect(checkSingle("c3", [acrossAisle, besideHold])).toEqual({ ok: true });
  });

  test("reconciliation keeps house, on-sale, pull-out, and sold seats on their confirmed paths", () => {
    const house = seat({ id: "house", status: "house", t2mStatus: "unavailable" });
    const houseOnSale = seat({
      id: "house-sale",
      status: "house",
      t2mStatus: "unavailable",
    });
    const unknown = seat({ id: "unknown", status: "direct_buy" });
    const soldThere = seat({
      id: "sold",
      status: "available_t2m",
      t2mStatus: "available",
    });
    const pulloutSold = seat({
      id: "pullout",
      status: "pullout_pending",
      t2mStatus: "available",
    });
    const back = seat({ id: "back", status: "sold_t2m", t2mStatus: "sold" });
    const flagged = seat({
      id: "flagged",
      status: "available_t2m",
      t2mStatus: "available",
    });
    const heldConflict = seat({ id: "held", status: "on_hold" });

    const result = reconcileShowbuy(
      [house, houseOnSale, unknown, soldThere, pulloutSold, back, flagged, heldConflict],
      {
        ok: true,
        bySeatId: {
          house: "unavailable",
          "house-sale": "available",
          unknown: "unknown",
          sold: "sold",
          pullout: "sold",
          back: "available",
          flagged: "unavailable",
          held: "sold",
        },
      },
    );
    const byId = Object.fromEntries(result.seats.map((item) => [item.id, item]));

    expect(byId.house?.status).toBe("house");
    expect(byId.house?.conflict).toBeNull();
    expect(byId["house-sale"]?.status).toBe("house");
    expect(byId["house-sale"]?.conflict).not.toBeNull();
    expect(byId.unknown?.conflict).not.toBeNull();
    expect(canHold(byId.unknown!)).toBe(false);
    expect(byId.sold?.status).toBe("sold_t2m");
    expect(byId.pullout?.status).toBe("sold_t2m");
    expect(byId.back?.status).toBe("available_t2m");
    expect(byId.flagged?.status).toBe("available_t2m");
    expect(byId.flagged?.conflict).not.toBeNull();
    expect(customerOffer(byId.flagged!)).toBe("unavailable");
    expect(byId.held?.status).toBe("on_hold");
    expect(byId.held?.conflict).not.toBeNull();
    expect(canHold(byId.held!)).toBe(false);
  });

  test("Feature 1: a partial showbuy can hold and offer only the selected sections", () => {
    const scope: SaleScope = { coverage: "partial", sectionIds: ["sec-a"] };
    const inside = seat({ id: "c5", sectionId: "sec-a" });
    const outside = seat({
      id: "d5",
      sectionId: "sec-b",
      row: "D",
      label: "D5",
    });
    const outsideOnSale = seat({
      id: "d6",
      sectionId: "sec-b",
      row: "D",
      number: 6,
      label: "D6",
      position: 6,
      status: "available_t2m",
      t2mStatus: "available",
    });

    const refused = holdChoices([outside, inside], ["d5"], ["c5"], scope);
    const held = holdChoices([outside, inside], ["c5"], ["d5"], scope);
    const moved = moveHold(
      [seat({ id: "c5", status: "on_hold" }), outside],
      ["c5"],
      ["d5"],
      false,
      scope,
    );

    expect(canHold(outside, scope)).toBe(false);
    expect(customerOffer(outside, scope)).toBe("unavailable");
    expect(customerOffer(outsideOnSale, scope)).toBe("unavailable");
    expect(canHold(inside, scope)).toBe(true);
    expect(customerOffer(inside, scope)).toBe("direct_buy");
    expect(refused.heldSeatIds).toEqual([]);
    expect(refused.seats.find((item) => item.id === "d5")?.status).toBe("direct_buy");
    expect(refused.seats.find((item) => item.id === "c5")?.status).toBe("direct_buy");
    expect(held.heldSeatIds).toEqual(["c5"]);
    expect(held.seats.find((item) => item.id === "d5")?.status).toBe("direct_buy");
    expect(moved.ok).toBe(false);
    expect(moved.seats.find((item) => item.id === "c5")?.status).toBe("on_hold");
    expect(moved.seats.find((item) => item.id === "d5")?.status).toBe("direct_buy");
  });

  test("Feature 2: the summary counts each status and drops house seats from both percentages", () => {
    const summary = inventorySummary([
      seat({ id: "house", status: "house", t2mStatus: "unavailable" }),
      seat({ id: "sale", status: "available_t2m", t2mStatus: "available" }),
      seat({ id: "direct", status: "direct_buy" }),
      seat({ id: "held", status: "on_hold" }),
      seat({ id: "t2m", status: "sold_t2m", t2mStatus: "sold" }),
      seat({ id: "direct-sold", status: "sold_direct", t2mStatus: "unavailable" }),
    ]);
    const onlyHouse = inventorySummary([
      seat({ id: "house", status: "house", t2mStatus: "unavailable" }),
    ]);
    const partial = inventorySummary(
      [
        seat({ id: "house", status: "house", t2mStatus: "unavailable" }),
        seat({
          id: "other",
          sectionId: "sec-b",
          status: "sold_direct",
          t2mStatus: "unavailable",
        }),
      ],
      { coverage: "partial", sectionIds: ["sec-a"] },
    );

    expect(summary.counts).toEqual({
      house: 1,
      available_t2m: 1,
      pullout_pending: 0,
      direct_buy: 1,
      on_hold: 1,
      sold_t2m: 1,
      sold_direct: 1,
    });
    expect(summary.percentSold).toBe(40);
    expect(summary.percentUnsold).toBe(60);
    expect(onlyHouse.percentSold).toBeNull();
    expect(onlyHouse.percentUnsold).toBeNull();
    expect(partial.counts.sold_direct).toBe(0);
    expect(partial.counts.house).toBe(1);
    expect(partial.percentSold).toBeNull();
  });

  test("Feature 4: SINGLE suggestions stay inside a partial showbuy's selected sections", () => {
    const scope: SaleScope = { coverage: "partial", sectionIds: ["sec-a"] };
    const chosen = seat({ id: "c2", number: 2, label: "C2", position: 2 });
    const neighbor = seat({
      id: "c3",
      number: 3,
      label: "C3",
      position: 3,
      status: "available_t2m",
      t2mStatus: "available",
    });
    const inSection = seat({ id: "c12", number: 12, label: "C12", position: 12 });
    const otherSection = seat({
      id: "c6",
      sectionId: "sec-b",
      number: 6,
      label: "C6",
      position: 6,
    });

    expect(checkSingle("c2", [chosen, neighbor, otherSection, inSection], scope)).toEqual({
      ok: false,
      suggestions: ["c12"],
    });
  });
});
