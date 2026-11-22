import {
  createReceiptReaderClient,
  readReceiptWithTimeout,
  type ReceiptImage,
} from "@/lib/adapters/ai/receipt-reader";
import { mapDbOrder } from "@/lib/order/map-order";
import { uploadReceipt as applyUploadReceipt } from "@/lib/rules/orders";
import {
  buildReceiptCheck,
  resolvePaymentModeChange,
  type ReceiptCheck,
} from "@/lib/rules/receipt-check";
import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ApplyReceiptResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "file_required"
        | "file_too_large"
        | "bad_file_type"
        | "not_found"
        | "upload_not_allowed"
        | "upload_failed"
        | "receipt_row_failed"
        | "status_update_failed";
    };

function mimeFromFile(type: string): ReceiptImage["mimeType"] | null {
  if (type === "image/png") return "image/png";
  if (type === "image/jpeg") return "image/jpeg";
  if (type === "image/webp") return "image/webp";
  return null;
}

function refsFromPayloads(
  rows: { check_payload: unknown; order_id: string }[],
  orderId: string,
): string[] {
  const refs: string[] = [];
  for (const row of rows) {
    if (row.order_id === orderId) continue;
    const payload = row.check_payload;
    if (!payload || typeof payload !== "object") continue;
    const reading = (payload as { reading?: { referenceNumber?: unknown } }).reading;
    const ref = reading?.referenceNumber;
    if (typeof ref === "string" && ref.trim()) refs.push(ref);
  }
  return refs;
}

/** Upload receipt image, run AI check, set Payment Submitted. Never sets Paid. */
export async function applyReceiptUploadForOrder(input: {
  supabase: ServiceClient;
  orderId: string;
  file: File;
}): Promise<ApplyReceiptResult> {
  const { supabase, orderId, file } = input;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "file_required" };
  }
  if (file.size > 4 * 1024 * 1024) return { ok: false, reason: "file_too_large" };
  const mime = mimeFromFile(file.type);
  if (!mime) return { ok: false, reason: "bad_file_type" };

  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "id, showbuy_id, status, created_at, hold_expires_at, payment_confirmed_at, payment_email_sent_at, claim_email_sent_at, claim_code, held_seat_ids, suggested_choice_seat_ids, applied_discount, manual_reason, total_centavos, payment_account_id, payment_timing",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!orderRow) return { ok: false, reason: "not_found" };

  const order = mapDbOrder(orderRow, Date.now());
  const next = applyUploadReceipt(order);
  if (next.status !== "payment_submitted") {
    return { ok: false, reason: "upload_not_allowed" };
  }

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${orderRow.showbuy_id}/${orderRow.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, reason: "upload_failed" };

  const { data: paymentAccounts } = await supabase
    .from("payment_accounts")
    .select("id, account_name, account_number, platform")
    .eq("showbuy_id", orderRow.showbuy_id);

  const selectedPayment =
    (paymentAccounts ?? []).find((account) => account.id === orderRow.payment_account_id) ??
    null;

  const { data: priorReceipts } = await supabase
    .from("receipts")
    .select("order_id, check_payload")
    .eq("showbuy_id", orderRow.showbuy_id);

  const readResult = await readReceiptWithTimeout(createReceiptReaderClient(), {
    bytes: new Uint8Array(buffer),
    mimeType: mime,
  });

  const existingReferences = refsFromPayloads(priorReceipts ?? [], orderRow.id);
  const nowIso = new Date().toISOString();
  const accountOptions = (paymentAccounts ?? []).map((account) => ({
    id: account.id,
    accountName: account.account_name,
    accountNumber: account.account_number,
    platform: account.platform,
  }));

  let paymentAccountId = orderRow.payment_account_id;
  let paymentForCheck = {
    accountName: selectedPayment?.account_name ?? "",
    accountNumber: selectedPayment?.account_number ?? "",
    platform: selectedPayment?.platform ?? "",
  };
  const modeNotes: string[] = [];

  if (readResult.ok && selectedPayment) {
    const modeChange = resolvePaymentModeChange({
      selectedAccountId: selectedPayment.id,
      selectedPlatform: selectedPayment.platform,
      reading: readResult.reading,
      accounts: accountOptions,
    });
    if (modeChange) {
      paymentAccountId = modeChange.paymentAccountId;
      const switched = accountOptions.find(
        (account) => account.id === modeChange.paymentAccountId,
      );
      if (switched) {
        paymentForCheck = {
          accountName: switched.accountName,
          accountNumber: switched.accountNumber,
          platform: switched.platform,
        };
      }
      modeNotes.push(modeChange.note);
    }
  }

  const check: ReceiptCheck = buildReceiptCheck({
    reading: readResult.ok ? readResult.reading : null,
    orderTotalCentavos: orderRow.total_centavos,
    orderCreatedAt: orderRow.created_at,
    holdExpiresAt: orderRow.hold_expires_at,
    nowIso,
    paymentAccount: paymentForCheck,
    existingReferences,
  });
  check.notes.push(...modeNotes);

  if (
    readResult.ok &&
    selectedPayment &&
    modeNotes.length === 0 &&
    check.warnings.includes("method_mismatch")
  ) {
    check.notes.push(
      `Receipt payment method (${readResult.reading.method ?? "unknown"}) does not match selected ${selectedPayment.platform}; no matching payment account to switch to.`,
    );
  }

  void check;

  const { error: receiptError } = await supabase.from("receipts").insert({
    order_id: orderRow.id,
    showbuy_id: orderRow.showbuy_id,
    file_path: path,
    check_payload: check,
  });
  if (receiptError) return { ok: false, reason: "receipt_row_failed" };

  const { error: orderError } = await supabase
    .from("orders")
    .update({
      status: "payment_submitted",
      payment_account_id: paymentAccountId,
    })
    .eq("id", orderRow.id);
  if (orderError) return { ok: false, reason: "status_update_failed" };

  return { ok: true };
}
