import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import {
  dateToManilaLocalInput,
  showbuyT2mFieldsLocked,
} from "@/lib/rules/showbuy";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { defaultShowbuyFormValues, ShowbuyForm } from "../../showbuy-form";

type Props = { params: Promise<{ id: string }> };

function parseExpenses(raw: unknown): { label: string; amountPesos: number }[] {
  if (!Array.isArray(raw)) return [{ label: "", amountPesos: 0 }];
  const rows = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { label?: unknown; amountCentavos?: unknown };
      if (typeof row.label !== "string" || typeof row.amountCentavos !== "number") {
        return null;
      }
      return { label: row.label, amountPesos: row.amountCentavos / 100 };
    })
    .filter((item): item is { label: string; amountPesos: number } => item !== null);
  return rows.length > 0 ? rows : [{ label: "", amountPesos: 0 }];
}

export default async function ShowbuySettingsPage({ params }: Props) {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const { id } = await params;
  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select(
      "id, name, event_url, t2m_show_id, starts_at, has_backend_access, coverage, t2m_fee_percent, capital_investment_centavos, other_expenses, claim_code_template, deduct_card_rebates",
    )
    .eq("id", id)
    .maybeSingle();
  if (!showbuy) redirect("/dashboard");

  const { count } = await supabase
    .from("seats")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", id);
  const t2mLocked = showbuyT2mFieldsLocked({ seatCount: count ?? 0 });

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: showbuy.name },
          { label: "Settings" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold">Edit settings</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Coverage: {showbuy.coverage === "partial" ? "partial" : "full"}
        {showbuy.coverage === "partial"
          ? " — for-sale sections are set on import."
          : " — every section is for sale."}
      </p>
      <ShowbuyForm
        mode="edit"
        showbuyId={id}
        t2mLocked={t2mLocked}
        initial={defaultShowbuyFormValues({
          name: showbuy.name,
          eventUrl: showbuy.event_url,
          t2mShowId: showbuy.t2m_show_id,
          startsAtManila: dateToManilaLocalInput(new Date(showbuy.starts_at)),
          hasBackendAccess: showbuy.has_backend_access,
          coverage: showbuy.coverage === "partial" ? "partial" : "full",
          feePercent: Number(showbuy.t2m_fee_percent),
          capitalPesos: showbuy.capital_investment_centavos / 100,
          otherExpenses: parseExpenses(showbuy.other_expenses),
          claimCodeTemplate: showbuy.claim_code_template,
          deductCardRebates: showbuy.deduct_card_rebates,
        })}
      />
    </main>
  );
}
