export type ClaimCodeParts = {
  section: string;
  order: string;
  seat: string;
  qty: number;
  discount: string;
  random?: () => string;
};

const RANDOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function validateClaimCodeTemplate(
  template: string,
): { ok: true } | { ok: false; reason: string } {
  if (!template.includes("{order}")) {
    return { ok: false, reason: "missing_order" };
  }
  return { ok: true };
}

export function randomClaimSegment(length = 8): string {
  const n = Math.max(6, length);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)]!;
  }
  return out;
}

export function formatClaimCode(template: string, parts: ClaimCodeParts): string {
  const random = parts.random?.() ?? randomClaimSegment(8);
  return template
    .replaceAll("{section}", parts.section)
    .replaceAll("{order}", parts.order)
    .replaceAll("{seat}", parts.seat)
    .replaceAll("{qty}", String(parts.qty))
    .replaceAll("{discount}", parts.discount)
    .replaceAll("{random}", random);
}
