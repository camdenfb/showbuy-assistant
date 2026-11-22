import { describe, expect, test } from "vitest";
import {
  extractT2mShowIdFromEventUrl,
  parseShowbuyFinance,
  parseShowbuySetupInput,
  showbuyT2mFieldsLocked,
} from "./showbuy";

describe("extractT2mShowIdFromEventUrl", () => {
  test("reads show id from ticket2me event/show URL", () => {
    expect(
      extractT2mShowIdFromEventUrl("https://ticket2me.net/event/23167/show/29225"),
    ).toBe("29225");
    expect(
      extractT2mShowIdFromEventUrl("https://www.ticket2me.net/event/23167/show/29225/"),
    ).toBe("29225");
  });

  test("returns null when pattern does not match", () => {
    expect(extractT2mShowIdFromEventUrl("https://ticket2me.net/event/23167")).toBeNull();
    expect(extractT2mShowIdFromEventUrl("https://example.com/show/1")).toBeNull();
    expect(extractT2mShowIdFromEventUrl("not-a-url")).toBeNull();
  });
});

describe("parseShowbuyFinance", () => {
  test("accepts fee, capital pesos, expenses, rebate flag", () => {
    expect(
      parseShowbuyFinance({
        feePercent: 8,
        capitalPesos: 130000,
        otherExpenses: [
          { label: "Marketing", amountPesos: 5000 },
          { label: "Transport", amountPesos: 0 },
        ],
        deductCardRebates: false,
      }),
    ).toEqual({
      ok: true,
      value: {
        feePercent: 8,
        capitalCentavos: 13_000_000,
        otherExpenses: [
          { label: "Marketing", amountCentavos: 500_000 },
          { label: "Transport", amountCentavos: 0 },
        ],
        deductCardRebates: false,
      },
    });
  });

  test("rejects negative money and fee out of range", () => {
    expect(
      parseShowbuyFinance({
        feePercent: 101,
        capitalPesos: 0,
        otherExpenses: [],
        deductCardRebates: false,
      }).ok,
    ).toBe(false);
    expect(
      parseShowbuyFinance({
        feePercent: 8,
        capitalPesos: -1,
        otherExpenses: [],
        deductCardRebates: false,
      }).ok,
    ).toBe(false);
    expect(
      parseShowbuyFinance({
        feePercent: 8,
        capitalPesos: 0,
        otherExpenses: [{ label: "X", amountPesos: -1 }],
        deductCardRebates: false,
      }).ok,
    ).toBe(false);
  });
});

describe("parseShowbuySetupInput", () => {
  const base = {
    name: "Die Beautiful — Mar 15",
    eventUrl: "https://ticket2me.net/event/23167/show/29225",
    t2mShowId: "29225",
    startsAtManila: "2027-03-15T20:00",
    hasBackendAccess: false,
    coverage: "full" as const,
    feePercent: 8,
    capitalPesos: 130000,
    otherExpenses: [{ label: "Marketing", amountPesos: 5000 }],
    claimCodeTemplate: "{section}{order}-{seat}-{qty}{discount}{random}",
    deductCardRebates: false,
  };

  test("accepts a valid create payload and stores starts_at as UTC instant", () => {
    const parsed = parseShowbuySetupInput(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe(base.name);
    expect(parsed.value.eventUrl).toBe(base.eventUrl);
    expect(parsed.value.t2mShowId).toBe("29225");
    expect(parsed.value.coverage).toBe("full");
    expect(parsed.value.capitalCentavos).toBe(13_000_000);
    expect(parsed.value.startsAt.toISOString()).toBe("2027-03-15T12:00:00.000Z");
  });

  test("requires https URL and valid claim template", () => {
    expect(
      parseShowbuySetupInput({ ...base, eventUrl: "http://ticket2me.net/event/1/show/2" }).ok,
    ).toBe(false);
    expect(
      parseShowbuySetupInput({
        ...base,
        claimCodeTemplate: "{section}-{seat}-{random}",
      }).ok,
    ).toBe(false);
  });
});

describe("showbuyT2mFieldsLocked", () => {
  test("locks event URL and show ID once any seat is imported", () => {
    expect(showbuyT2mFieldsLocked({ seatCount: 0 })).toBe(false);
    expect(showbuyT2mFieldsLocked({ seatCount: 1 })).toBe(true);
  });
});
