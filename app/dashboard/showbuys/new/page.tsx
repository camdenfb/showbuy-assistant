import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { NewShowbuyForm } from "./new-showbuy-form";

export const instant = false;

export default async function NewShowbuyPage() {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "New showbuy" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold">New showbuy</h1>
      <p className="mt-1 text-sm text-zinc-600">
        After create you go to seat map import, then set payment accounts.
      </p>
      <NewShowbuyForm />
    </main>
  );
}
