import Link from "next/link";
import { redirect } from "next/navigation";
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-zinc-900">Dashboard</h1>
      <p className="mt-2 text-sm text-zinc-600">Signed in as {auth.email}</p>
      <ul className="mt-8 space-y-3">
        {(showbuys ?? []).map((showbuy) => (
          <li key={showbuy.id} className="flex items-center justify-between border-b py-3">
            <span>{showbuy.name}</span>
            <Link
              className="text-sm font-medium text-zinc-900 underline"
              href={`/dashboard/showbuys/${showbuy.id}/import`}
            >
              Import seat map
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
