"use server";

import { revalidatePath } from "next/cache";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type PaymentState =
  | { ok: true; message: string }
  | { ok: false; reason: string };

export async function savePaymentAccount(
  showbuyId: string,
  _prev: PaymentState | null,
  formData: FormData,
): Promise<PaymentState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const id = String(formData.get("id") ?? "").trim();
  const platform = String(formData.get("platform") ?? "").trim();
  const accountName = String(formData.get("accountName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").trim();
  const qr = formData.get("qr");

  if (!platform || platform.length > 80) return { ok: false, reason: "invalid_platform" };
  if (!accountName || !accountNumber) return { ok: false, reason: "missing_fields" };

  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) return { ok: false, reason: "showbuy_not_found" };

  let qrPath: string | null = null;
  if (qr instanceof File && qr.size > 0) {
    if (qr.size > 4 * 1024 * 1024) return { ok: false, reason: "qr_too_large" };
    if (!["image/png", "image/jpeg", "image/webp"].includes(qr.type)) {
      return { ok: false, reason: "qr_bad_type" };
    }
    const ext = qr.type === "image/png" ? "png" : qr.type === "image/webp" ? "webp" : "jpg";
    const path = `${showbuyId}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await qr.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("payment-qrs")
      .upload(path, buffer, { contentType: qr.type, upsert: false });
    if (uploadError) return { ok: false, reason: "qr_upload_failed" };
    qrPath = path;
  }

  if (id) {
    const patch: Record<string, string | null> = {
      platform,
      account_name: accountName,
      account_number: accountNumber,
    };
    if (qrPath) patch.qr_code_path = qrPath;
    const { error } = await supabase
      .from("payment_accounts")
      .update(patch)
      .eq("id", id)
      .eq("showbuy_id", showbuyId);
    if (error) return { ok: false, reason: "update_failed" };
  } else {
    const { error } = await supabase.from("payment_accounts").insert({
      showbuy_id: showbuyId,
      platform,
      account_name: accountName,
      account_number: accountNumber,
      qr_code_path: qrPath,
    });
    if (error) return { ok: false, reason: "insert_failed" };
  }

  revalidatePath(`/dashboard/showbuys/${showbuyId}/payments`);
  return { ok: true, message: "Payment account saved." };
}

export async function deletePaymentAccount(
  showbuyId: string,
  accountId: string,
): Promise<PaymentState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("payment_accounts")
    .delete()
    .eq("id", accountId)
    .eq("showbuy_id", showbuyId);
  if (error) return { ok: false, reason: "delete_failed" };

  revalidatePath(`/dashboard/showbuys/${showbuyId}/payments`);
  return { ok: true, message: "Payment account removed." };
}
