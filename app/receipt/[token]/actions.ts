"use server";

import { applyReceiptUploadForOrder } from "@/lib/order/apply-receipt-upload";
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

  const supabase = createSupabaseServiceClient();
  const { data: orderRow } = await supabase
    .from("orders")
    .select("id")
    .eq("receipt_token", token)
    .maybeSingle();
  if (!orderRow) return { ok: false, reason: "not_found" };

  const result = await applyReceiptUploadForOrder({
    supabase,
    orderId: orderRow.id,
    file,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  return { ok: true, message: "Receipt uploaded. The showbuyer will confirm payment." };
}
