"use server";

import { revalidatePath } from "next/cache";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { validatePriceCentavos } from "@/lib/rules/price";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type PromoState =
  | { ok: true; message: string }
  | { ok: false; reason: string };

function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

export async function savePromo(
  showbuyId: string,
  _prev: PromoState | null,
  formData: FormData,
): Promise<PromoState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const id = String(formData.get("id") ?? "").trim();
  const code = normalizeCode(String(formData.get("code") ?? ""));
  const active = formData.get("active") === "on";
  const requiresSingle = formData.get("requiresSingle") === "on";
  const limitRaw = String(formData.get("usageLimit") ?? "").trim();
  const usageLimit =
    limitRaw === "" ? null : Number.parseInt(limitRaw, 10);

  if (!code) return { ok: false, reason: "code_required" };
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 0)) {
    return { ok: false, reason: "invalid_usage_limit" };
  }

  const supabase = createSupabaseServiceClient();
  const { data: sections } = await supabase
    .from("sections")
    .select("id, name, is_for_sale")
    .eq("showbuy_id", showbuyId);

  const forSale = (sections ?? []).filter((section) => section.is_for_sale !== false);
  const groupKeys = [
    ...new Set(
      forSale
        .map((section) => section.name.trim().toLowerCase())
        .filter((key) => key.length > 0),
    ),
  ];
  const groupCentavos = new Map<string, number>();
  for (const key of groupKeys) {
    const pesos = Number(formData.get(`price_group_${key}`));
    if (!Number.isFinite(pesos) || pesos < 0) continue;
    const centavos = Math.round(pesos * 100);
    if (!validatePriceCentavos(centavos)) {
      return { ok: false, reason: "invalid_section_price" };
    }
    groupCentavos.set(key, centavos);
  }

  const prices: Record<string, number> = {};
  for (const section of forSale) {
    const key = section.name.trim().toLowerCase();
    const fromGroup = groupCentavos.get(key);
    if (fromGroup != null) {
      prices[section.id] = fromGroup;
      continue;
    }
    // Fallback: per-section field (older forms / partial edits)
    const pesos = Number(formData.get(`price_${section.id}`));
    if (!Number.isFinite(pesos) || pesos < 0) continue;
    const centavos = Math.round(pesos * 100);
    if (!validatePriceCentavos(centavos)) {
      return { ok: false, reason: "invalid_section_price" };
    }
    prices[section.id] = centavos;
  }
  if (Object.keys(prices).length === 0) {
    return { ok: false, reason: "need_section_price" };
  }

  const row = {
    code,
    active,
    requires_single_seat: requiresSingle,
    usage_limit: usageLimit,
    price_centavos_by_section: prices,
  };

  if (id) {
    const { error } = await supabase
      .from("promos")
      .update(row)
      .eq("id", id)
      .eq("showbuy_id", showbuyId);
    if (error) return { ok: false, reason: error.code === "23505" ? "code_taken" : "update_failed" };
  } else {
    const { error } = await supabase.from("promos").insert({
      showbuy_id: showbuyId,
      ...row,
    });
    if (error) return { ok: false, reason: error.code === "23505" ? "code_taken" : "insert_failed" };
  }

  revalidatePath(`/dashboard/showbuys/${showbuyId}/promos`);
  return { ok: true, message: "Promo saved." };
}

export async function setPromoActive(
  showbuyId: string,
  promoId: string,
  active: boolean,
): Promise<PromoState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("promos")
    .update({ active })
    .eq("id", promoId)
    .eq("showbuy_id", showbuyId);
  if (error) return { ok: false, reason: "update_failed" };

  revalidatePath(`/dashboard/showbuys/${showbuyId}/promos`);
  return { ok: true, message: active ? "Promo activated." : "Promo deactivated." };
}

export async function deletePromo(
  showbuyId: string,
  promoId: string,
): Promise<PromoState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("promos")
    .delete()
    .eq("id", promoId)
    .eq("showbuy_id", showbuyId);
  if (error) return { ok: false, reason: "delete_failed" };

  revalidatePath(`/dashboard/showbuys/${showbuyId}/promos`);
  return { ok: true, message: "Promo removed." };
}
