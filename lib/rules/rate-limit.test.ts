import { describe, expect, test } from "vitest";
import { allowRateLimit, type RateLimitStore } from "./rate-limit";

describe("allowRateLimit", () => {
  test("allows until max hits in the window", () => {
    const store: RateLimitStore = new Map();
    const now = 1_000_000;
    expect(
      allowRateLimit(store, { key: "ip:1.1.1.1", max: 2, windowMs: 60_000, now }),
    ).toBe(true);
    expect(
      allowRateLimit(store, { key: "ip:1.1.1.1", max: 2, windowMs: 60_000, now: now + 1 }),
    ).toBe(true);
    expect(
      allowRateLimit(store, { key: "ip:1.1.1.1", max: 2, windowMs: 60_000, now: now + 2 }),
    ).toBe(false);
  });

  test("resets after the window", () => {
    const store: RateLimitStore = new Map();
    const now = 1_000_000;
    allowRateLimit(store, { key: "email:a@b.c", max: 1, windowMs: 1000, now });
    expect(
      allowRateLimit(store, { key: "email:a@b.c", max: 1, windowMs: 1000, now: now + 1001 }),
    ).toBe(true);
  });
});
