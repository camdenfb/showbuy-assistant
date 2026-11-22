export type ReceiptReading = {
  amountPesos: number | null;
  paidAt: string | null;
  recipientName: string | null;
  recipientAccountLast4: string | null;
  referenceNumber: string | null;
  method: "gcash" | "maya" | "bank" | "other" | null;
  readable: boolean;
  note: string;
};

export type ReceiptWarning =
  | "amount_mismatch"
  | "recipient_mismatch"
  | "date_mismatch"
  | "duplicate_reference"
  | "unreadable"
  | "ai_unavailable"
  | "method_mismatch";

export type ReceiptCheck = {
  reading: ReceiptReading | null;
  warnings: ReceiptWarning[];
  notes: string[];
};

export type PaymentAccountForCheck = {
  accountName: string;
  accountNumber: string;
  platform: string;
};

export type PaymentAccountOption = PaymentAccountForCheck & { id: string };

export type PaymentModeChange = {
  paymentAccountId: string;
  fromPlatform: string;
  toPlatform: string;
  note: string;
};

const BANK_PLATFORM_HINTS = [
  "bpi",
  "bdo",
  "bank",
  "unionbank",
  "metrobank",
  "rcbc",
  "landbank",
  "pnb",
  "security bank",
];

export function normalizePaymentMethod(
  platform: string,
): NonNullable<ReceiptReading["method"]> {
  const key = platform.trim().toLowerCase();
  if (!key) return "other";
  if (key.includes("gcash") || key === "g-cash") return "gcash";
  if (key.includes("maya") || key.includes("paymaya")) return "maya";
  if (BANK_PLATFORM_HINTS.some((hint) => key.includes(hint))) return "bank";
  return "other";
}

function methodsCompatible(
  selectedPlatform: string,
  receiptMethod: ReceiptReading["method"],
): boolean {
  if (!receiptMethod || receiptMethod === "other") return true;
  return normalizePaymentMethod(selectedPlatform) === receiptMethod;
}

export function resolvePaymentModeChange(input: {
  selectedAccountId: string;
  selectedPlatform: string;
  reading: ReceiptReading;
  accounts: readonly PaymentAccountOption[];
}): PaymentModeChange | null {
  const method = input.reading.method;
  if (!method || method === "other") return null;
  if (methodsCompatible(input.selectedPlatform, method)) return null;

  const last4 = input.reading.recipientAccountLast4;
  const sameMethod = input.accounts.filter(
    (account) => normalizePaymentMethod(account.platform) === method,
  );
  if (sameMethod.length === 0) return null;

  const matched =
    (last4
      ? sameMethod.find((account) => accountLast4(account.accountNumber) === last4)
      : undefined) ?? sameMethod[0]!;

  if (matched.id === input.selectedAccountId) return null;

  return {
    paymentAccountId: matched.id,
    fromPlatform: input.selectedPlatform,
    toPlatform: matched.platform,
    note: `Payment mode updated from ${input.selectedPlatform} to ${matched.platform} (receipt looked like ${method}).`,
  };
}

function manilaDayKey(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True for QR payee labels like "Bakli (QR Code)" — not a legal account name. */
export function looksLikeQrRecipientLabel(name: string): boolean {
  const n = normalizeName(name);
  return /\(qr\s*code\)/.test(n) || /\bqr\s*code\b/.test(n);
}

function accountLast4(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  return digits.slice(-4);
}

/** Only compare when we have a full 4-digit suffix (masked bank receipts often show 3). */
function comparableLast4(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function buildReceiptCheck(input: {
  reading: ReceiptReading | null;
  orderTotalCentavos: number;
  orderCreatedAt: string;
  holdExpiresAt: string;
  paymentAccount: PaymentAccountForCheck;
  existingReferences: readonly string[];
  /** ISO now for “not in the future” (caller supplies; keeps rule pure). */
  nowIso: string;
}): ReceiptCheck {
  if (input.reading === null) {
    return { reading: null, warnings: ["ai_unavailable"], notes: [] };
  }

  const reading = input.reading;
  const warnings: ReceiptWarning[] = [];
  const notes: string[] = [];

  if (!reading.readable || reading.amountPesos === null) {
    warnings.push("unreadable");
  } else if (Math.round(reading.amountPesos * 100) !== input.orderTotalCentavos) {
    warnings.push("amount_mismatch");
  }

  const expectedLast4 = comparableLast4(input.paymentAccount.accountNumber);
  const gotLast4 = comparableLast4(reading.recipientAccountLast4);
  if (gotLast4 && expectedLast4) {
    if (gotLast4 !== expectedLast4) {
      warnings.push("recipient_mismatch");
    }
  } else if (
    reading.recipientName &&
    !looksLikeQrRecipientLabel(reading.recipientName)
  ) {
    const expected = normalizeName(input.paymentAccount.accountName);
    const got = normalizeName(reading.recipientName);
    if (!expected.includes(got) && !got.includes(expected)) {
      warnings.push("recipient_mismatch");
    }
  }

  if (!methodsCompatible(input.paymentAccount.platform, reading.method)) {
    warnings.push("method_mismatch");
  }

  if (reading.paidAt) {
    const paidDay = manilaDayKey(reading.paidAt);
    const startDay = manilaDayKey(input.orderCreatedAt);
    const endDay = manilaDayKey(input.holdExpiresAt);
    const todayManila = manilaDayKey(input.nowIso);
    if (
      !paidDay ||
      !startDay ||
      !endDay ||
      paidDay < startDay ||
      paidDay > endDay ||
      (todayManila !== null && paidDay > todayManila)
    ) {
      warnings.push("date_mismatch");
    }
  }

  if (
    reading.referenceNumber &&
    input.existingReferences.some((ref) => ref === reading.referenceNumber)
  ) {
    warnings.push("duplicate_reference");
  }

  return { reading, warnings, notes };
}
