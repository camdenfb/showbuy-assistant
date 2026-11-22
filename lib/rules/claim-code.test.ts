import { describe, expect, test } from "vitest";
import {
  abbreviateSectionCode,
  claimDiscountCode,
  formatClaimCode,
  formatClaimOrderId,
  randomClaimSegment,
  validateClaimCodeTemplate,
} from "./claim-code";

describe("claim code template", () => {
  test("requires {order} and {random}", () => {
    expect(validateClaimCodeTemplate("{section}-{random}")).toEqual({
      ok: false,
      reason: "missing_order",
    });
    expect(validateClaimCodeTemplate("{section}-{order}")).toEqual({
      ok: false,
      reason: "missing_random",
    });
    expect(
      validateClaimCodeTemplate("{section}{order}-{seat}-{qty}{discount}{random}"),
    ).toEqual({ ok: true });
  });

  test("rejects unknown placeholders", () => {
    expect(validateClaimCodeTemplate("{order}-{random}-{foo}")).toEqual({
      ok: false,
      reason: "unknown_placeholder",
    });
  });

  test("expands placeholders with 3-digit random", () => {
    const code = formatClaimCode("{section}{order}-{seat}-{qty}{discount}{random}", {
      section: "HE",
      order: "01",
      seat: "Q23",
      qty: 2,
      discount: "NO",
      random: () => "123",
    });
    expect(code).toBe("HE01-Q23-2NO123");
  });

  test("generates 3-digit random when none supplied", () => {
    const code = formatClaimCode("{order}-{random}", {
      section: "X",
      order: "01",
      seat: "A1",
      qty: 1,
      discount: "NO",
    });
    const random = code.slice("01-".length);
    expect(random).toMatch(/^\d{3}$/);
  });
});

describe("claim code parts", () => {
  test("abbreviates Heart and Talent", () => {
    expect(abbreviateSectionCode("Heart")).toBe("HE");
    expect(abbreviateSectionCode("Talent")).toBe("TL");
    expect(abbreviateSectionCode("  HEART  ")).toBe("HE");
  });

  test("pads order id to at least 2 digits", () => {
    expect(formatClaimOrderId("1")).toBe("01");
    expect(formatClaimOrderId("12")).toBe("12");
    expect(formatClaimOrderId("123")).toBe("123");
  });

  test("maps discount to PW SR or NO", () => {
    expect(claimDiscountCode({ appliedDiscount: "rebate", discountCard: "pwd" })).toBe(
      "PW",
    );
    expect(
      claimDiscountCode({ appliedDiscount: "rebate", discountCard: "senior" }),
    ).toBe("SR");
    expect(claimDiscountCode({ appliedDiscount: "promo", discountCard: "pwd" })).toBe(
      "NO",
    );
    expect(claimDiscountCode({ appliedDiscount: "none", discountCard: "none" })).toBe(
      "NO",
    );
  });

  test("randomClaimSegment defaults to 3 digits", () => {
    expect(randomClaimSegment()).toMatch(/^\d{3}$/);
  });
});
