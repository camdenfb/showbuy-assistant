import { describe, expect, test } from "vitest";
import { isShowbuyerEmail } from "./allowlist";

describe("showbuyer allowlist", () => {
  test("denies everyone when the allowlist is missing or empty", () => {
    expect(isShowbuyerEmail("a@example.test", undefined)).toBe(false);
    expect(isShowbuyerEmail("a@example.test", "")).toBe(false);
    expect(isShowbuyerEmail("a@example.test", "  ,  ")).toBe(false);
  });

  test("matches case-insensitively", () => {
    expect(isShowbuyerEmail("A@Example.TEST", "b@x.test, a@example.test")).toBe(true);
    expect(isShowbuyerEmail("other@example.test", "a@example.test")).toBe(false);
    expect(isShowbuyerEmail(null, "a@example.test")).toBe(false);
  });
});
