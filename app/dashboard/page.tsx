import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const supabase = createSupabaseServiceClient();
  const { data: showbuys } = await supabase
    .from("showbuys")
    .select("id, name, starts_at")
    .order("starts_at");

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs items={[{ label: "Dashboard" }]} />
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">Signed in as {auth.email}</p>
        </div>
        <span className="flex gap-3 text-sm font-medium">
          <Link href="/dashboard/showbuys/new" className="underline">
            New showbuy
          </Link>
          <Link href="/dashboard/analytics" className="underline">
            Analytics
          </Link>
          <Link href="/dashboard/outbox" className="underline">
            Demo outbox
          </Link>
        </span>
      </div>
      <ul className="mt-8 space-y-4">
        {(showbuys ?? []).map((showbuy) => (
          <li key={showbuy.id} className="border-b border-zinc-200 py-4 text-zinc-900">
            <p className="font-medium">{showbuy.name}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {new Date(showbuy.starts_at).toLocaleString("en-PH", {
                timeZone: "Asia/Manila",
              })}
            </p>
            <span className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
              <Link className="underline" href={`/dashboard/showbuys/${showbuy.id}/orders`}>
                Orders
              </Link>
              <Link className="underline" href={`/dashboard/showbuys/${showbuy.id}/import`}>
                Inventory
              </Link>
              <Link className="underline" href={`/order/${showbuy.id}`}>
                Order page
              </Link>
              <Link className="underline" href={`/dashboard/showbuys/${showbuy.id}/payments`}>
                Payments
              </Link>
              <Link className="underline" href={`/dashboard/showbuys/${showbuy.id}/promos`}>
                Promos
              </Link>
              <Link
                className="underline"
                href={`/dashboard/analytics?showbuy=${showbuy.id}`}
              >
                Analytics
              </Link>
              <Link
                className="underline"
                href={`/dashboard/showbuys/${showbuy.id}/settings`}
              >
                Edit settings
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
