import { redirect } from "next/navigation";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { loginAction } from "./actions";

export default async function LoginPage() {
  const auth = await requireShowbuyer();
  if (auth.ok) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Showbuy Assistant
      </h1>
      <p className="text-sm text-zinc-600">Sign in with an allowlisted showbuyer account.</p>
      <form action={loginAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
