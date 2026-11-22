"use server";

import { uploadReceipt as applyUploadReceipt } from "@/lib/rules/orders";
import { mapDbOrder } from "@/lib/order/map-order";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ReceiptUploadState =
  | { ok: true; message: string }
  | { ok: false; reason: string };

export async function uploadReceiptAction(
  token: string,
  _prev: ReceiptUploadState | null,
  formData: FormData,
): Promise<ReceiptUploadState> {
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "file_required" };
  }
  if (file.size > 4 * 1024 * 1024) return { ok: false, reason: "file_too_large" };
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return { ok: false, reason: "bad_file_type" };
  }

  const supabase = createSupabaseServiceClient();
  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "id, showbuy_id, status, hold_expires_at, payment_confirmed_at, payment_email_sent_at, claim_email_sent_at, claim_code, held_seat_ids, suggested_choice_seat_ids, applied_discount, manual_reason",
    )
    .eq("receipt_token", token)
    .maybeSingle();
  if (!orderRow) return { ok: false, reason: "not_found" };

  const order = mapDbOrder(orderRow);
  const next = applyUploadReceipt(order);
  if (next.status !== "payment_submitted") {
    return { ok: false, reason: "upload_not_allowed" };
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${orderRow.showbuy_id}/${orderRow.id}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, reason: "upload_failed" };

  const { error: receiptError } = await supabase.from("receipts").insert({
    order_id: orderRow.id,
    showbuy_id: orderRow.showbuy_id,
    file_path: path,
    check_payload: {},
  });
  if (receiptError) return { ok: false, reason: "receipt_row_failed" };

  const { error: orderError } = await supabase
    .from("orders")
    .update({ status: "payment_submitted" })
    .eq("id", orderRow.id);
  if (orderError) return { ok: false, reason: "status_update_failed" };

  return { ok: true, message: "Receipt uploaded. The showbuyer will confirm payment." };
}
