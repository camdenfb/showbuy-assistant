import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { PromoForm } from "./promo-form";

type Props = { params: Promise<{ id: string }> };

export default async function PromosPage({ params }: Props) {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const { id } = await params;
  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!showbuy) redirect("/dashboard");

  const [{ data: sections }, { data: promos }] = await Promise.all([
    supabase
      .from("sections")
      .select("id, name, regular_price_centavos, is_for_sale")
      .eq("showbuy_id", id)
      .order("name"),
    supabase
      .from("promos")
      .select(
        "id, code, active, usage_limit, requires_single_seat, price_centavos_by_section",
      )
      .eq("showbuy_id", id)
      .order("code"),
  ]);

  const forSale = (sections ?? []).filter((section) => section.is_for_sale !== false);

  const mappedPromos = (promos ?? []).map((promo) => ({
    ...promo,
    price_centavos_by_section:
      promo.price_centavos_by_section &&
      typeof promo.price_centavos_by_section === "object" &&
      !Array.isArray(promo.price_centavos_by_section)
        ? (promo.price_centavos_by_section as Record<string, number>)
        : {},
  }));

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: showbuy.name },
          { label: "Promos" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold">Promos</h1>
      <div className="mt-8">
        <PromoForm showbuyId={id} sections={forSale} promos={mappedPromos} />
      </div>
    </main>
  );
}
