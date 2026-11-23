import {
  createEmailClient,
  type ClaimCodeEmail,
  type EmailSendResult,
  type PaymentInfoEmail,
} from "../adapters/email";
import type { createSupabaseServiceClient } from "../supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type EmailType = "payment_info" | "claim_code";

export type DispatchResult =
  | { ok: true; emailed: true }
  | { ok: true; emailed: false; skipped: true }
  | { ok: false; reason: string; emailed: false };

/**
 * Claim the unique email_outbox row, then send once via the shared email client.
 * Already-sent rows are skipped so Process orders can run twice safely.
 */
export async function dispatchOrderEmail(
  supabase: ServiceClient,
  input:
    | { type: "payment_info"; email: PaymentInfoEmail }
    | { type: "claim_code"; email: ClaimCodeEmail },
  client = createEmailClient(),
): Promise<DispatchResult> {
  const orderId = input.email.orderId;
  const emailType: EmailType = input.type;

  const claimed = await claimOutboxRow(supabase, orderId, emailType);
  if (claimed === "already_sent") {
    return { ok: true, emailed: false, skipped: true };
  }

  const result: EmailSendResult =
    input.type === "payment_info"
      ? await client.sendPaymentInfo(input.email)
      : await client.sendClaimCode(input.email);

  if (result.ok) {
    await supabase
      .from("email_outbox")
      .update({ sent_at: new Date().toISOString(), last_error: null })
      .eq("order_id", orderId)
      .eq("email_type", emailType);
    return { ok: true, emailed: true };
  }

  await supabase
    .from("email_outbox")
    .update({ last_error: result.reason })
    .eq("order_id", orderId)
    .eq("email_type", emailType);

  return { ok: false, reason: result.reason, emailed: false };
}

async function claimOutboxRow(
  supabase: ServiceClient,
  orderId: string,
  emailType: EmailType,
): Promise<"claimed" | "already_sent" | "retry"> {
  const { data: inserted, error } = await supabase
    .from("email_outbox")
    .insert({ order_id: orderId, email_type: emailType })
    .select("id, sent_at")
    .maybeSingle();

  if (!error && inserted) return "claimed";

  const { data: existing } = await supabase
    .from("email_outbox")
    .select("id, sent_at, last_error")
    .eq("order_id", orderId)
    .eq("email_type", emailType)
    .maybeSingle();

  if (!existing) return "claimed";
  if (existing.sent_at) return "already_sent";

  await supabase
    .from("email_outbox")
    .update({ last_error: null })
    .eq("id", existing.id);
  return "retry";
}
