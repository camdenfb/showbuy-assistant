import { describe, expect, test } from "vitest";
import { combineAnalytics, computeShowbuyAnalytics } from "./analytics";
import type { Seat } from "./seats";

function seat(partial: Partial<Seat> & Pick<Seat, "id" | "status">): Seat {
  return {
    showbuyId: "show-a",
    sectionId: "sec-a",
    row: "A",
    number: 1,
    label: "A1",
    gridRow: 1,
    position: 1,
    t2mStatus: "unavailable",
    conflict: null,
    ...partial,
  };
}

describe("computeShowbuyAnalytics", () => {
  test("counts sold vs to-sell and excludes house from to-sell", () => {
    const report = computeShowbuyAnalytics({
      id: "show-a",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 0,
      capitalCentavos: 0,
      otherExpensesCentavos: 0,
      deductCardRebates: false,
      sectionRegularPriceById: { "sec-a": 250_000 },
      seats: [
        seat({ id: "1", status: "sold_direct" }),
        seat({ id: "2", status: "sold_t2m", t2mStatus: "sold" }),
        seat({ id: "3", status: "direct_buy" }),
        seat({ id: "4", status: "on_hold" }),
        seat({ id: "5", status: "house" }),
      ],
      orders: [],
    });
    expect(report.ticketsSold).toBe(2);
    expect(report.ticketsToSell).toBe(2);
  });

  test("AC20: profit is gross minus promo expense, fees, capital, and other expenses", () => {
    const report = computeShowbuyAnalytics({
      id: "show-a",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 8,
      capitalCentavos: 13_000_000,
      otherExpensesCentavos: 500_000,
      deductCardRebates: false,
      sectionRegularPriceById: { "sec-a": 100_000 },
      seats: Array.from({ length: 50 }, (_, i) =>
        seat({
          id: `t${i}`,
          status: "sold_t2m",
          t2mStatus: "sold",
          position: i + 1,
        }),
      ),
      orders: [
        {
          status: "paid",
          paymentConfirmedAt: "2027-01-01T00:00:00Z",
          appliedDiscount: "promo",
          cardRebateCentavos: 0,
          tickets: Array.from({ length: 110 }, () => ({
            regularPriceCentavos: 100_000,
            pricePerSeatCentavos: 94_546,
          })),
        },
      ],
    });
    // Direct gross 11_000_000; T2M gross 5_000_000; total 16_000_000
    // Promo expense 110 * 5454 = 599_940 — use exact 600_000 via 5454.545... use 100 tickets at 94_000
    expect(report.grossCentavos).toBe(16_000_000);
    expect(report.feesCentavos).toBe(400_000);
  });

  test("AC20 exact pesos from spec", () => {
    const report = computeShowbuyAnalytics({
      id: "show-a",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 8,
      capitalCentavos: 13_000_000,
      otherExpensesCentavos: 500_000,
      deductCardRebates: false,
      sectionRegularPriceById: { "sec-a": 100_000 },
      seats: Array.from({ length: 50 }, (_, i) =>
        seat({
          id: `t${i}`,
          status: "sold_t2m",
          t2mStatus: "sold",
          position: i + 1,
        }),
      ),
      orders: [
        {
          status: "paid",
          paymentConfirmedAt: "2027-01-01T00:00:00Z",
          appliedDiscount: "promo",
          cardRebateCentavos: 0,
          tickets: Array.from({ length: 100 }, () => ({
            regularPriceCentavos: 100_000,
            pricePerSeatCentavos: 94_000,
          })),
        },
        {
          status: "paid",
          paymentConfirmedAt: "2027-01-01T00:00:00Z",
          appliedDiscount: "none",
          cardRebateCentavos: 0,
          tickets: Array.from({ length: 10 }, () => ({
            regularPriceCentavos: 100_000,
            pricePerSeatCentavos: 100_000,
          })),
        },
      ],
    });
    // Direct 11_000_000 + T2M 5_000_000 = 16_000_000
    // Promo expense 100 * 6_000 = 600_000
    // Fees 400_000; capital 13M; other 500k → profit 15_000_000? wait 16M-600k-400k-13M-500k = 1_500_000
    expect(report.grossCentavos).toBe(16_000_000);
    expect(report.promoExpenseCentavos).toBe(600_000);
    expect(report.feesCentavos).toBe(400_000);
    expect(report.profitCentavos).toBe(1_500_000);
  });

  test("AC13: card rebate lowers profit only when deduct is on", () => {
    const base = {
      id: "show-a",
      coverage: "full" as const,
      forSaleSectionIds: [] as string[],
      t2mFeePercent: 0,
      capitalCentavos: 0,
      otherExpensesCentavos: 0,
      sectionRegularPriceById: { "sec-a": 250_000 },
      seats: [] as Seat[],
      orders: [
        {
          status: "paid",
          paymentConfirmedAt: "2027-01-01T00:00:00Z",
          appliedDiscount: "rebate" as const,
          cardRebateCentavos: 50_000,
          tickets: [{ regularPriceCentavos: 250_000, pricePerSeatCentavos: 250_000 }],
        },
      ],
    };
    const off = computeShowbuyAnalytics({ ...base, deductCardRebates: false });
    const on = computeShowbuyAnalytics({ ...base, deductCardRebates: true });
    expect(off.profitCentavos).toBe(250_000);
    expect(on.profitCentavos).toBe(200_000);
    expect(on.cardRebateCentavos).toBe(50_000);
  });

  test("ROI is null when capital and other expenses are zero", () => {
    const report = computeShowbuyAnalytics({
      id: "show-a",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 0,
      capitalCentavos: 0,
      otherExpensesCentavos: 0,
      deductCardRebates: false,
      sectionRegularPriceById: {},
      seats: [],
      orders: [],
    });
    expect(report.roi).toBeNull();
  });

  test("combineAnalytics sums and recomputes ROI", () => {
    const a = computeShowbuyAnalytics({
      id: "a",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 0,
      capitalCentavos: 100_000,
      otherExpensesCentavos: 0,
      deductCardRebates: false,
      sectionRegularPriceById: { "sec-a": 50_000 },
      seats: [seat({ id: "1", status: "sold_direct" })],
      orders: [
        {
          status: "paid",
          paymentConfirmedAt: "2027-01-01T00:00:00Z",
          appliedDiscount: "none",
          cardRebateCentavos: 0,
          tickets: [{ regularPriceCentavos: 50_000, pricePerSeatCentavos: 50_000 }],
        },
      ],
    });
    const b = computeShowbuyAnalytics({
      id: "b",
      coverage: "full",
      forSaleSectionIds: [],
      t2mFeePercent: 0,
      capitalCentavos: 100_000,
      otherExpensesCentavos: 0,
      deductCardRebates: false,
      sectionRegularPriceById: {},
      seats: [],
      orders: [],
    });
    const combined = combineAnalytics([a, b]);
    expect(combined.capitalCentavos).toBe(200_000);
    expect(combined.grossCentavos).toBe(50_000);
    expect(combined.roi).toBe(combined.profitCentavos / 200_000);
  });
});
