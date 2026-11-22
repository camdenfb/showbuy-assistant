import type { Order, OrderStatus } from "../rules/orders";
import { PAYMENT_HOLD_MS } from "../rules/orders";

type DbOrder = {
  id: string;
  status: string;
  hold_expires_at: string | null;
  payment_confirmed_at: string | null;
  payment_email_sent_at: string | null;
  claim_email_sent_at: string | null;
  claim_code: string | null;
  held_seat_ids: string[];
  suggested_choice_seat_ids: string[] | null;
  applied_discount: string;
  manual_reason: string | null;
  payment_timing?: string | null;
};

export function mapDbOrder(row: DbOrder, nowMs: number): Order {
  const expiresAt = row.hold_expires_at ? Date.parse(row.hold_expires_at) : NaN;
  const holdRemainingMs = Number.isFinite(expiresAt)
    ? Math.max(0, expiresAt - nowMs)
    : PAYMENT_HOLD_MS;
  const status = row.status as OrderStatus;
  const holdPaused = status === "payment_submitted";
  const timing = row.payment_timing;
  const paymentTiming =
    timing === "now" || timing === "later" ? timing : null;

  return {
    id: row.id,
    status,
    holdRemainingMs,
    holdPaused,
    paymentConfirmedAt: row.payment_confirmed_at,
    paymentEmailSentAt: row.payment_email_sent_at,
    claimEmailSentAt: row.claim_email_sent_at,
    claimCode: row.claim_code,
    heldSeatIds: row.held_seat_ids ?? [],
    suggestedChoice: row.suggested_choice_seat_ids,
    appliedDiscount: row.applied_discount as Order["appliedDiscount"],
    manualReason: row.manual_reason,
    paymentTiming,
  };
}
