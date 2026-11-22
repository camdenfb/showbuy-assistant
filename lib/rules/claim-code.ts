export type ClaimCodeParts = {
  section: string;
  order: string;
  seat: string;
  firstSeat?: string;
  qty: number;
  discount: string;
  random?: () => string;
};

const ALLOWED = new Set([
  "section",
  "order",
  "seat",
  "first_seat",
  "qty",
  "discount",
  "random",
]);

export function validateClaimCodeTemplate(
  template: string,
): { ok: true } | { ok: false; reason: string } {
  if (!template.includes("{order}")) {
    return { ok: false, reason: "missing_order" };
  }
  if (!template.includes("{random}")) {
    return { ok: false, reason: "missing_random" };
  }
  const tokens = template.match(/\{[a-zA-Z_]+\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!ALLOWED.has(name)) {
      return { ok: false, reason: "unknown_placeholder" };
    }
  }
  return { ok: true };
}

/** Exactly 3 random digits for claim codes. */
export function randomClaimSegment(length = 3): string {
  const n = length === 3 ? 3 : Math.max(3, length);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out;
}

export function formatClaimCode(template: string, parts: ClaimCodeParts): string {
  const random = parts.random?.() ?? randomClaimSegment(3);
  const firstSeat = parts.firstSeat ?? parts.seat;
  return template
    .replaceAll("{section}", parts.section)
    .replaceAll("{order}", parts.order)
    .replaceAll("{first_seat}", firstSeat)
    .replaceAll("{seat}", parts.seat)
    .replaceAll("{qty}", String(parts.qty))
    .replaceAll("{discount}", parts.discount)
    .replaceAll("{random}", random);
}

export function abbreviateSectionCode(sectionName: string): string {
  const key = sectionName.trim().toLowerCase();
  if (key === "heart") return "HE";
  if (key === "talent") return "TL";
  const compact = sectionName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.slice(0, 2) || "XX";
}

/** Showbuy-local sequence: 1 → "01", 12 → "12", 100 → "100". */
export function formatClaimOrderNumber(orderNumber: number): string {
  if (!Number.isInteger(orderNumber) || orderNumber < 1) {
    return "01";
  }
  return String(orderNumber).padStart(2, "0");
}

/** @deprecated Prefer formatClaimOrderNumber for sequential showbuy order numbers. */
export function formatClaimOrderId(orderId: string): string {
  const trimmed = orderId.trim();
  if (/^\d+$/.test(trimmed)) {
    return formatClaimOrderNumber(Number(trimmed));
  }
  return trimmed;
}

/** PWD → PW, senior → SR, otherwise NO. */
export function claimDiscountCode(input: {
  appliedDiscount: "none" | "promo" | "rebate" | string;
  discountCard: "none" | "pwd" | "senior" | string;
}): "PW" | "SR" | "NO" {
  if (input.appliedDiscount !== "rebate") return "NO";
  if (input.discountCard === "pwd") return "PW";
  if (input.discountCard === "senior") return "SR";
  return "NO";
}
