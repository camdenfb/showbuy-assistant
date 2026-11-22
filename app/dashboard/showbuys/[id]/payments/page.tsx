import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { PaymentForm } from "./payment-form";

type Props = { params: Promise<{ id: string }> };

export default async function PaymentsPage({ params }: Props) {
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

  const { data: accounts } = await supabase
    .from("payment_accounts")
    .select("id, platform, account_name, account_number, qr_code_path")
    .eq("showbuy_id", id)
    .order("platform");

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: showbuy.name },
          { label: "Payments" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold">Payment settings</h1>
      <div className="mt-8">
        <PaymentForm showbuyId={id} accounts={accounts ?? []} />
      </div>
    </main>
  );
}
