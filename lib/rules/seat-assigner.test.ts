import { describe, expect, test } from "vitest";
import type { Seat } from "./seats";
import {
  buildSeatCandidates,
  fallbackSeatPicks,
  sanitizeSeatPicks,
  type SeatCandidate,
  type SeatPicks,
} from "./seat-assigner";

function seat(partial: Partial<Seat> & Pick<Seat, "id" | "label">): Seat {
  return {
    showbuyId: "show-1",
    sectionId: "sec-a",
    row: "C",
    number: 1,
    gridRow: 1,
    position: 0,
    status: "direct_buy",
    t2mStatus: "unavailable",
    conflict: null,
    ...partial,
  };
}

describe("buildSeatCandidates", () => {
  test("returns contiguous direct-buy blocks in the preferred section nearest the first choice", () => {
    const seats = [
      seat({ id: "a1", label: "A1", row: "A", number: 1, gridRow: 1, position: 0 }),
      seat({ id: "a2", label: "A2", row: "A", number: 2, gridRow: 1, position: 1 }),
      seat({
        id: "b1",
        label: "B1",
        row: "B",
        number: 1,
        gridRow: 5,
        position: 0,
        sectionId: "sec-b",
      }),
      seat({
        id: "c1",
        label: "C1",
        row: "C",
        number: 1,
        gridRow: 2,
        position: 0,
        status: "house",
      }),
      seat({ id: "a3", label: "A3", row: "A", number: 3, gridRow: 1, position: 2 }),
    ];

    const candidates = buildSeatCandidates({
      seats,
      preferredSectionId: "sec-a",
      qty: 2,
      firstChoiceSeatIds: ["a1", "a2"],
      requiresSingle: false,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.id.startsWith("opt_"))).toBe(true);
    expect(candidates[0]?.seatIds).toEqual(["a1", "a2"]);
    expect(candidates.some((c) => c.seatIds.includes("b1"))).toBe(false);
    expect(candidates.some((c) => c.seatIds.includes("c1"))).toBe(false);
  });

  test("SINGLE only keeps isolated single seats", () => {
    const seats = [
      seat({ id: "a1", label: "A1", row: "A", number: 1, gridRow: 1, position: 0 }),
      seat({ id: "a2", label: "A2", row: "A", number: 2, gridRow: 1, position: 1 }),
      seat({ id: "b5", label: "B5", row: "B", number: 5, gridRow: 3, position: 0 }),
    ];
    const candidates = buildSeatCandidates({
      seats,
      preferredSectionId: "sec-a",
      qty: 1,
      firstChoiceSeatIds: ["a1"],
      requiresSingle: true,
    });
    expect(candidates.map((c) => c.seatIds)).toEqual([["b5"]]);
  });
});

describe("sanitizeSeatPicks", () => {
  const candidates: SeatCandidate[] = [
    {
      id: "opt_1",
      seatIds: ["a1"],
      rowsFromFront: 1,
      rowsFromFirstChoice: 0,
      seatsFromFirstChoice: 0,
      facts: ["near_front", "same_row"],
    },
    {
      id: "opt_2",
      seatIds: ["b5"],
      rowsFromFront: 3,
      rowsFromFirstChoice: 2,
      seatsFromFirstChoice: 4,
      facts: ["aisle", "near_back"],
    },
  ];

  test("AC31: drops unknown ids, repeats, and facts code did not supply", () => {
    const raw: SeatPicks = {
      picks: [
        { id: "opt_1", matchedFacts: ["near_front", "aisle"] },
        { id: "opt_99", matchedFacts: ["near_front"] },
        { id: "opt_1", matchedFacts: ["same_row"] },
        { id: "opt_2", matchedFacts: ["aisle", "near_back"] },
      ],
      hasUncheckableRequest: false,
    };
    const cleaned = sanitizeSeatPicks(raw, candidates);
    expect(cleaned.picks.map((p) => p.id)).toEqual(["opt_1", "opt_2"]);
    expect(cleaned.picks[0]?.matchedFacts).toEqual(["near_front"]);
    expect(cleaned.picks[1]?.matchedFacts).toEqual(["aisle", "near_back"]);
  });
});

describe("fallbackSeatPicks", () => {
  test("AC32: fills up to three nearest candidates when AI fails", () => {
    const candidates: SeatCandidate[] = [
      {
        id: "opt_1",
        seatIds: ["a"],
        rowsFromFront: 1,
        rowsFromFirstChoice: 0,
        seatsFromFirstChoice: 0,
        facts: ["near_front"],
      },
      {
        id: "opt_2",
        seatIds: ["b"],
        rowsFromFront: 2,
        rowsFromFirstChoice: 1,
        seatsFromFirstChoice: 1,
        facts: ["near_front"],
      },
      {
        id: "opt_3",
        seatIds: ["c"],
        rowsFromFront: 3,
        rowsFromFirstChoice: 2,
        seatsFromFirstChoice: 2,
        facts: ["near_back"],
      },
      {
        id: "opt_4",
        seatIds: ["d"],
        rowsFromFront: 4,
        rowsFromFirstChoice: 3,
        seatsFromFirstChoice: 3,
        facts: ["near_back"],
      },
    ];
    const picks = fallbackSeatPicks(candidates);
    expect(picks.picks).toHaveLength(3);
    expect(picks.picks.map((p) => p.id)).toEqual(["opt_1", "opt_2", "opt_3"]);
    expect(picks.hasUncheckableRequest).toBe(false);
  });
});
