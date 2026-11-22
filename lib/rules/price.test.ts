import { describe, expect, test } from "vitest";
import {
  assignPromoUses,
  countPromoUses,
  profitCentavos,
  quotePrice,
  saleAccounting,
  ticket2meFeeCentavos,
  validateFeePercent,
  validatePriceCentavos,
  type Promo,
} from "./price";

const summer: Promo = {
  code: "summer",
  active: true,
  priceCentavosBySection: { "sec-a": 70_000 },
  usageLimit: null,
  requiresSingleSeat: false,
};

describe("price and discount rules", () => {
  test("AC10: an inactive promo is rejected and an order already placed keeps its saved price", () => {
    const quote = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: { ...summer, active: false },
      enteredCode: "summer",
      discountCard: "none",
      promoUses: 0,
      browserTotalCentavos: 1,
    });
    const saved = saleAccounting({
      status: "paid",
      paymentConfirmed: true,
      appliedDiscount: "promo",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 70_000 }],
      currentSectionPriceCentavos: 250_000,
    });

    expect(quote).toEqual({ ok: false, reason: "inactive_code" });
    expect(saved.grossCentavos).toBe(100_000);
    expect(saved.promoExpenseCentavos).toBe(30_000);
  });

  test("AC11: a promo limited to one use is granted to exactly one of two simultaneous orders", () => {
    const granted = assignPromoUses(
      [{ id: "order-a" }, { id: "order-b" }],
      1,
      0,
    );

    expect(granted.filter((item) => item.granted)).toEqual([
      { id: "order-a", granted: true },
    ]);
    expect(countPromoUses([
      { appliedDiscount: "promo", status: "cancelled" },
      { appliedDiscount: "promo", status: "paid" },
      { appliedDiscount: "rebate", status: "paid" },
    ])).toBe(1);
  });

  test("AC13: a ₱500 card rebate leaves profit unchanged when the setting is off and lowers it by ₱500 when on", () => {
    const base = {
      grossCentavos: 200_000,
      promoExpenseCentavos: 0,
      feesCentavos: 0,
      capitalCentavos: 0,
      otherExpensesCentavos: 0,
      cardRebateCentavos: 50_000,
    };

    expect(profitCentavos({ ...base, deductCardRebates: false })).toBe(200_000);
    expect(profitCentavos({ ...base, deductCardRebates: true })).toBe(150_000);
  });

  test("AC14: a price sent by the browser is ignored", () => {
    const quote = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: null,
      enteredCode: null,
      discountCard: "none",
      promoUses: 0,
      browserTotalCentavos: 1,
    });

    expect(quote).toEqual({
      ok: true,
      applied: "none",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 100_000 }],
      totalCentavos: 100_000,
      cardRebateCentavos: 0,
    });
  });

  test("AC21: a valid promo wins over a card rebate and sets the rebate to zero even if the rebate is worth more", () => {
    const promoWins = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: summer,
      enteredCode: " summer ",
      discountCard: "senior",
      promoUses: 0,
    });
    const promoStillWinsWhenRebateLarger = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: { ...summer, priceCentavosBySection: { "sec-a": 95_000 } },
      enteredCode: "SUMMER",
      discountCard: "pwd",
      promoUses: 0,
    });

    expect(promoWins).toEqual({
      ok: true,
      applied: "promo",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 70_000 }],
      totalCentavos: 70_000,
      cardRebateCentavos: 0,
    });
    expect(promoStillWinsWhenRebateLarger).toEqual({
      ok: true,
      applied: "promo",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 95_000 }],
      totalCentavos: 95_000,
      cardRebateCentavos: 0,
    });
  });

  test("AC30: 4 tickets at ₱2,500 with a PWD or senior card pay ₱10,000 and get a ₱2,000 show-day rebate", () => {
    const seats = Array.from({ length: 4 }, () => ({
      sectionId: "sec-a",
      regularPriceCentavos: 250_000,
    }));

    for (const discountCard of ["pwd", "senior"] as const) {
      const quote = quotePrice({
        seats,
        promo: null,
        enteredCode: null,
        discountCard,
        promoUses: 0,
      });

      expect(quote).toEqual({
        ok: true,
        applied: "rebate",
        tickets: seats.map((seat) => ({
          regularPriceCentavos: seat.regularPriceCentavos,
          pricePerSeatCentavos: 250_000,
        })),
        totalCentavos: 1_000_000,
        cardRebateCentavos: 200_000,
      });
    }
  });

  test("AC22: a later section price does not change saved gross sales or promo expense", () => {
    const confirmed = saleAccounting({
      status: "sent_claim_code",
      paymentConfirmed: true,
      appliedDiscount: "promo",
      tickets: [{ regularPriceCentavos: 160_000, pricePerSeatCentavos: 100_000 }],
      currentSectionPriceCentavos: 999_999,
    });
    const unpaid = saleAccounting({
      status: "sent_payment_info",
      paymentConfirmed: false,
      appliedDiscount: "promo",
      tickets: [{ regularPriceCentavos: 160_000, pricePerSeatCentavos: 100_000 }],
      currentSectionPriceCentavos: 999_999,
    });

    expect(confirmed).toEqual({ grossCentavos: 160_000, promoExpenseCentavos: 60_000 });
    expect(unpaid).toEqual({ grossCentavos: 0, promoExpenseCentavos: 0 });
  });

  test("equal promo and rebate savings still apply the promo with rebate zero", () => {
    const quote = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: { ...summer, priceCentavosBySection: { "sec-a": 80_000 } },
      enteredCode: "summer",
      discountCard: "pwd",
      promoUses: 0,
    });

    expect(quote).toEqual({
      ok: true,
      applied: "promo",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 80_000 }],
      totalCentavos: 80_000,
      cardRebateCentavos: 0,
    });
  });

  test("a card rebate is 20% of every ticket's regular price and is not deducted from the total", () => {
    const quote = quotePrice({
      seats: [
        { sectionId: "sec-a", regularPriceCentavos: 100_000 },
        { sectionId: "sec-a", regularPriceCentavos: 100_000 },
      ],
      promo: null,
      enteredCode: null,
      discountCard: "senior",
      promoUses: 0,
    });

    expect(quote).toEqual({
      ok: true,
      applied: "rebate",
      tickets: [
        { regularPriceCentavos: 100_000, pricePerSeatCentavos: 100_000 },
        { regularPriceCentavos: 100_000, pricePerSeatCentavos: 100_000 },
      ],
      totalCentavos: 200_000,
      cardRebateCentavos: 40_000,
    });
  });

  test("a promo at its usage limit is rejected, and a null limit does not cap uses", () => {
    const capped = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: { ...summer, usageLimit: 1 },
      enteredCode: "summer",
      discountCard: "none",
      promoUses: 1,
    });
    const open = assignPromoUses([{ id: "order-a" }, { id: "order-b" }], null, 4);

    expect(capped).toEqual({ ok: false, reason: "usage_limit" });
    expect(open).toEqual([
      { id: "order-a", granted: true },
      { id: "order-b", granted: true },
    ]);
  });

  test("prices cannot be negative and the Ticket2Me fee cannot exceed 100%", () => {
    expect(validatePriceCentavos(0)).toBe(true);
    expect(validatePriceCentavos(100)).toBe(true);
    expect(validatePriceCentavos(-1)).toBe(false);
    expect(validatePriceCentavos(10.5)).toBe(false);
    expect(validateFeePercent(0)).toBe(true);
    expect(validateFeePercent(100)).toBe(true);
    expect(validateFeePercent(-1)).toBe(false);
    expect(validateFeePercent(100.01)).toBe(false);
    expect(
      quotePrice({
        seats: [{ sectionId: "sec-a", regularPriceCentavos: -1 }],
        promo: null,
        enteredCode: null,
        discountCard: "none",
        promoUses: 0,
      }),
    ).toEqual({ ok: false, reason: "negative_price" });
  });

  test("AC20: profit is gross sales minus promo expense, fees, capital, and other expenses", () => {
    expect(
      profitCentavos({
        grossCentavos: 16_000_000,
        promoExpenseCentavos: 600_000,
        feesCentavos: 400_000,
        capitalCentavos: 13_000_000,
        otherExpensesCentavos: 500_000,
        cardRebateCentavos: 0,
        deductCardRebates: false,
      }),
    ).toBe(1_500_000);
  });

  test("Feature 4: SINGLE applies to one seat and is rejected for any other quantity", () => {
    const single: Promo = { ...summer, code: "SINGLE", requiresSingleSeat: true };
    const one = quotePrice({
      seats: [{ sectionId: "sec-a", regularPriceCentavos: 100_000 }],
      promo: single,
      enteredCode: "single",
      discountCard: "senior",
      promoUses: 0,
    });
    const two = quotePrice({
      seats: [
        { sectionId: "sec-a", regularPriceCentavos: 100_000 },
        { sectionId: "sec-a", regularPriceCentavos: 100_000 },
      ],
      promo: { ...single, code: "SINGLE" },
      enteredCode: " single ",
      discountCard: "senior",
      promoUses: 0,
    });

    expect(one).toEqual({
      ok: true,
      applied: "promo",
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 70_000 }],
      totalCentavos: 70_000,
      cardRebateCentavos: 0,
    });
    expect(two).toEqual({ ok: false, reason: "single_one_seat" });
  });

  test("Feature 8: the Ticket2Me fee is the show percentage of saved regular prices sold there", () => {
    expect(
      ticket2meFeeCentavos(
        [
          { status: "sold_t2m", regularPriceCentavos: 1_000_000 },
          { status: "sold_direct", regularPriceCentavos: 1_000_000 },
          { status: "sold_t2m", regularPriceCentavos: 500_000 },
        ],
        4,
      ),
    ).toBe(60_000);
    expect(ticket2meFeeCentavos([], 10)).toBe(0);
    expect(ticket2meFeeCentavos([{ status: "sold_t2m", regularPriceCentavos: 100 }], -1)).toBe(
      null,
    );
  });
});
