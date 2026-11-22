import Link from "next/link";
import { redirect } from "next/navigation";
import { listOutbox } from "@/lib/adapters/email";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";

export default async function OutboxPage() {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const messages = listOutbox();

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <p className="text-sm">
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Demo email outbox</h1>
      <p className="mt-1 text-sm text-zinc-600">
        In-memory messages from this server process. Refresh after Process orders or a new hold.
      </p>
      <ul className="mt-8 space-y-4">
        {messages.map((message) => (
          <li key={message.id} className="rounded border border-zinc-200 p-4 text-sm">
            <p className="font-medium">
              {message.kind} · {message.subject}
            </p>
            <p className="mt-1 text-zinc-600">{message.createdAt}</p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-zinc-800">{message.body}</pre>
          </li>
        ))}
        {messages.length === 0 ? (
          <li className="text-sm text-zinc-600">Outbox is empty.</li>
        ) : null}
      </ul>
    </main>
  );
}
