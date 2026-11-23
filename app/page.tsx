import Link from "next/link";
import { redirect } from "next/navigation";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";

export const instant = false;

export default async function HomePage() {
  const auth = await requireShowbuyer();
  if (auth.ok) redirect("/dashboard");

  return (
    <main className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-zinc-100 px-6 py-16 text-zinc-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#fafafa_0%,_#e4e4e7_55%,_#d4d4d8_100%)]"
      />
      <div className="relative mx-auto w-full max-w-lg">
        <p className="text-5xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
          Showbuy Assistant
        </p>
        <p className="mt-4 max-w-md text-lg leading-8 text-zinc-600">
          Run several Ticket2Me showbuys from one dashboard — inventory, orders,
          and claim codes.
        </p>
        <div className="mt-10">
          <Link
            href="/login"
            className="inline-flex items-center rounded bg-black px-5 py-3 text-sm font-medium text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
