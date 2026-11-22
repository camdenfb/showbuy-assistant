"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import {
  parseShowbuySetupInput,
  showbuyT2mFieldsLocked,
  type ShowbuyExpense,
} from "@/lib/rules/showbuy";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ShowbuyFormState =
  | { ok: true; message: string; showbuyId?: string }
  | { ok: false; reason: string };

function readExpenses(formData: FormData): { label: string; amountPesos: number }[] {
  const labels = formData.getAll("expenseLabel").map(String);
  const pesos = formData.getAll("expensePesos").map(String);
  const rows: { label: string; amountPesos: number }[] = [];
  for (let i = 0; i < labels.length; i++) {
    rows.push({
      label: labels[i] ?? "",
      amountPesos: Number(pesos[i]),
    });
  }
  return rows;
}

function readSetupFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    eventUrl: String(formData.get("eventUrl") ?? ""),
    t2mShowId: String(formData.get("t2mShowId") ?? ""),
    startsAtManila: String(formData.get("startsAtManila") ?? ""),
    hasBackendAccess: formData.get("hasBackendAccess") === "on",
    coverage: String(formData.get("coverage") ?? "") as "full" | "partial",
    feePercent: Number(formData.get("feePercent")),
    capitalPesos: Number(formData.get("capitalPesos")),
    otherExpenses: readExpenses(formData),
    claimCodeTemplate: String(formData.get("claimCodeTemplate") ?? ""),
    deductCardRebates: formData.get("deductCardRebates") === "on",
    syncIntervalMinutes: Number(formData.get("syncIntervalMinutes")),
  };
}

function rowFromParsed(value: {
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
  syncIntervalMinutes: number;
}) {
  return {
    name: value.name,
    event_url: value.eventUrl,
    t2m_show_id: value.t2mShowId,
    starts_at: value.startsAt.toISOString(),
    has_backend_access: value.hasBackendAccess,
    coverage: value.coverage,
    t2m_fee_percent: value.feePercent,
    capital_investment_centavos: value.capitalCentavos,
    other_expenses: value.otherExpenses,
    claim_code_template: value.claimCodeTemplate,
    deduct_card_rebates: value.deductCardRebates,
    sync_interval_minutes: value.syncIntervalMinutes,
  };
}

export async function createShowbuy(
  _prev: ShowbuyFormState | null,
  formData: FormData,
): Promise<ShowbuyFormState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const parsed = parseShowbuySetupInput(readSetupFields(formData));
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("showbuys")
    .insert(rowFromParsed(parsed.value))
    .select("id")
    .single();

  if (error || !data) return { ok: false, reason: "insert_failed" };

  revalidatePath("/dashboard");
  redirect(`/dashboard/showbuys/${data.id}/import`);
}

export async function updateShowbuy(
  showbuyId: string,
  _prev: ShowbuyFormState | null,
  formData: FormData,
): Promise<ShowbuyFormState> {
  const auth = await requireShowbuyer();
  if (!auth.ok) return { ok: false, reason: auth.reason };

  const supabase = createSupabaseServiceClient();
  const { count } = await supabase
    .from("seats")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", showbuyId);
  const locked = showbuyT2mFieldsLocked({ seatCount: count ?? 0 });

  const { data: existing } = await supabase
    .from("showbuys")
    .select("event_url, t2m_show_id")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "not_found" };

  const fields = readSetupFields(formData);
  if (locked) {
    fields.eventUrl = existing.event_url;
    fields.t2mShowId = existing.t2m_show_id;
  }

  const parsed = parseShowbuySetupInput(fields);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const full = rowFromParsed(parsed.value);
  const row = locked
    ? {
        name: full.name,
        starts_at: full.starts_at,
        has_backend_access: full.has_backend_access,
        coverage: full.coverage,
        t2m_fee_percent: full.t2m_fee_percent,
        capital_investment_centavos: full.capital_investment_centavos,
        other_expenses: full.other_expenses,
        claim_code_template: full.claim_code_template,
        deduct_card_rebates: full.deduct_card_rebates,
        sync_interval_minutes: full.sync_interval_minutes,
      }
    : full;

  const { error } = await supabase.from("showbuys").update(row).eq("id", showbuyId);
  if (error) return { ok: false, reason: "update_failed" };

  if (parsed.value.coverage === "full") {
    await supabase
      .from("sections")
      .update({ is_for_sale: true })
      .eq("showbuy_id", showbuyId);
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/showbuys/${showbuyId}/settings`);
  revalidatePath("/dashboard/analytics");
  return { ok: true, message: "Showbuy settings saved." };
}
