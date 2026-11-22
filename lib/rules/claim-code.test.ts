import { describe, expect, test } from "vitest";
import { formatClaimCode, validateClaimCodeTemplate } from "./claim-code";

describe("claim code template", () => {
  test("requires {order}", () => {
    expect(validateClaimCodeTemplate("{section}-{random}")).toEqual({
      ok: false,
      reason: "missing_order",
    });
    expect(validateClaimCodeTemplate("{section}-{order}-{random}")).toEqual({ ok: true });
  });

  test("expands placeholders with at least 6 random characters", () => {
    const code = formatClaimCode("{section}-{order}-{seat}-{qty}-{discount}-{random}", {
      section: "Heart",
      order: "a1b2c3d4",
      seat: "R15",
      qty: 2,
      discount: "none",
      random: () => "ABCDEFGH",
    });
    expect(code).toBe("Heart-a1b2c3d4-R15-2-none-ABCDEFGH");
  });

  test("generates random when none supplied", () => {
    const code = formatClaimCode("{order}-{random}", {
      section: "X",
      order: "ord1",
      seat: "A1",
      qty: 1,
      discount: "promo",
    });
    const random = code.slice("ord1-".length);
    expect(random.length).toBeGreaterThanOrEqual(6);
    expect(random).toMatch(/^[A-Za-z0-9]+$/);
  });
});
