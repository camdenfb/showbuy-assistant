export type RateLimitStore = Map<string, number[]>;

export function allowRateLimit(
  store: RateLimitStore,
  input: { key: string; max: number; windowMs: number; now: number },
): boolean {
  const cutoff = input.now - input.windowMs;
  const prior = (store.get(input.key) ?? []).filter((ts) => ts > cutoff);
  if (prior.length >= input.max) {
    store.set(input.key, prior);
    return false;
  }
  prior.push(input.now);
  store.set(input.key, prior);
  return true;
}

/** Process-local store for order submission limits. */
export const orderRateLimitStore: RateLimitStore = new Map();

export const ORDER_RATE_LIMITS = {
  perIp: { max: 20, windowMs: 60 * 60 * 1000 },
  perEmail: { max: 5, windowMs: 60 * 60 * 1000 },
} as const;
