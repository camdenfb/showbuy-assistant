import { z } from "zod";
import { validateClaimCodeTemplate } from "./claim-code";
import { validateFeePercent, validatePriceCentavos } from "./price";

/** Pattern: https://ticket2me.net/event/{eventId}/show/{showId} (optional www). */
const T2M_EVENT_SHOW_URL =
  /^https:\/\/(?:www\.)?ticket2me\.net\/event\/([^/?#]+)\/show\/([^/?#]+)\/?$/i;

export function extractT2mShowIdFromEventUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = T2M_EVENT_SHOW_URL.exec(trimmed);
  if (!match) return null;
  const showId = match[2]?.trim();
  return showId && showId.length > 0 ? showId : null;
}

export type ShowbuyExpense = { label: string; amountCentavos: number };

export type ShowbuyFinanceValue = {
  feePercent: number;
  capitalCentavos: number;
  otherExpenses: ShowbuyExpense[];
  deductCardRebates: boolean;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const expenseInputSchema = z.object({
  label: z.string(),
  amountPesos: z.number(),
});

const financeInputSchema = z.object({
  feePercent: z.number(),
  capitalPesos: z.number(),
  otherExpenses: z.array(expenseInputSchema),
  deductCardRebates: z.boolean(),
});

export function parseShowbuyFinance(
  input: z.infer<typeof financeInputSchema>,
): ParseResult<ShowbuyFinanceValue> {
  const parsed = financeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_finance" };

  const { feePercent, capitalPesos, otherExpenses, deductCardRebates } = parsed.data;
  if (!validateFeePercent(feePercent)) return { ok: false, reason: "invalid_fee" };
  if (!Number.isFinite(capitalPesos) || capitalPesos < 0) {
    return { ok: false, reason: "invalid_capital" };
  }
  const capitalCentavos = Math.round(capitalPesos * 100);
  if (!validatePriceCentavos(capitalCentavos)) {
    return { ok: false, reason: "invalid_capital" };
  }

  const expenses: ShowbuyExpense[] = [];
  for (const row of otherExpenses) {
    const label = row.label.trim();
    if (!label && (!Number.isFinite(row.amountPesos) || row.amountPesos === 0)) {
      continue;
    }
    if (!label || !Number.isFinite(row.amountPesos) || row.amountPesos < 0) {
      return { ok: false, reason: "invalid_expense" };
    }
    const amountCentavos = Math.round(row.amountPesos * 100);
    if (!validatePriceCentavos(amountCentavos)) {
      return { ok: false, reason: "invalid_expense" };
    }
    expenses.push({ label, amountCentavos });
  }

  return {
    ok: true,
    value: {
      feePercent,
      capitalCentavos,
      otherExpenses: expenses,
      deductCardRebates,
    },
  };
}

const setupInputSchema = z.object({
  name: z.string().trim().min(1),
  eventUrl: z.string().trim(),
  t2mShowId: z.string().trim().min(1),
  startsAtManila: z.string().trim().min(1),
  hasBackendAccess: z.boolean(),
  coverage: z.enum(["full", "partial"]),
  feePercent: z.number(),
  capitalPesos: z.number(),
  otherExpenses: z.array(expenseInputSchema),
  claimCodeTemplate: z.string().trim().min(1),
  deductCardRebates: z.boolean(),
});

export type ShowbuySetupValue = {
  name: string;
  eventUrl: string;
  t2mShowId: string;
  startsAt: Date;
  hasBackendAccess: boolean;
  coverage: "full" | "partial";
  feePercent: number;
  capitalCentavos: number;
  otherExpenses: ShowbuyExpense[];
  claimCodeTemplate: string;
  deductCardRebates: boolean;
};

/** Parse `YYYY-MM-DDTHH:mm` as Asia/Manila wall time → Date (UTC instant). */
export function manilaLocalToDate(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const asUtcGuess = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`);
  if (!Number.isFinite(asUtcGuess)) return null;
  return new Date(asUtcGuess);
}

export function dateToManilaLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function validateHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseShowbuySetupInput(
  input: z.infer<typeof setupInputSchema>,
): ParseResult<ShowbuySetupValue> {
  const parsed = setupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  const data = parsed.data;
  if (!validateHttpsUrl(data.eventUrl)) return { ok: false, reason: "invalid_url" };

  const startsAt = manilaLocalToDate(data.startsAtManila);
  if (!startsAt) return { ok: false, reason: "invalid_starts_at" };

  const templateCheck = validateClaimCodeTemplate(data.claimCodeTemplate);
  if (!templateCheck.ok) return templateCheck;

  const finance = parseShowbuyFinance({
    feePercent: data.feePercent,
    capitalPesos: data.capitalPesos,
    otherExpenses: data.otherExpenses,
    deductCardRebates: data.deductCardRebates,
  });
  if (!finance.ok) return finance;

  return {
    ok: true,
    value: {
      name: data.name,
      eventUrl: data.eventUrl,
      t2mShowId: data.t2mShowId,
      startsAt,
      hasBackendAccess: data.hasBackendAccess,
      coverage: data.coverage,
      feePercent: finance.value.feePercent,
      capitalCentavos: finance.value.capitalCentavos,
      otherExpenses: finance.value.otherExpenses,
      claimCodeTemplate: data.claimCodeTemplate,
      deductCardRebates: finance.value.deductCardRebates,
    },
  };
}

export function showbuyT2mFieldsLocked(input: { seatCount: number }): boolean {
  return input.seatCount > 0;
}
