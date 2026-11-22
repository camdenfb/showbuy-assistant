"use client";

import { useActionState } from "react";
import {
  deletePaymentAccount,
  savePaymentAccount,
  type PaymentState,
} from "./actions";

type Account = {
  id: string;
  platform: string;
  account_name: string;
  account_number: string;
  qr_code_path: string | null;
};

type Props = {
  showbuyId: string;
  accounts: Account[];
};

export function PaymentForm({ showbuyId, accounts }: Props) {
  const bound = savePaymentAccount.bind(null, showbuyId);
  const [state, formAction, pending] = useActionState<PaymentState | null, FormData>(
    bound,
    null,
  );

  return (
    <div className="space-y-8">
      {state?.ok ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{state.message}</p>
      ) : null}
      {state && !state.ok ? (
        <p className="text-sm text-red-700">{state.reason}</p>
      ) : null}

      <ul className="space-y-3">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 py-3 text-sm"
          >
            <span>
              {account.platform} · {account.account_name} · {account.account_number}
              {account.qr_code_path ? " · QR on file" : ""}
            </span>
            <form
              action={async () => {
                await deletePaymentAccount(showbuyId, account.id);
              }}
            >
              <button type="submit" className="underline">
                Remove
              </button>
            </form>
          </li>
        ))}
        {accounts.length === 0 ? (
          <li className="text-sm text-zinc-600">No payment accounts yet.</li>
        ) : null}
      </ul>

      <form action={formAction} className="max-w-md space-y-3" encType="multipart/form-data">
        <h2 className="text-lg font-medium text-zinc-900">Add payment account</h2>
        <p className="text-sm text-zinc-600">Use fictional details only.</p>
        <label className="block text-sm">
          Platform
          <input
            name="platform"
            required
            placeholder="GCash, BPI, Maya, …"
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
          />
        </label>
        <label className="block text-sm">
          Account name
          <input
            name="accountName"
            required
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
          />
        </label>
        <label className="block text-sm">
          Account number
          <input
            name="accountNumber"
            required
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2"
          />
        </label>
        <label className="block text-sm">
          QR code (optional)
          <input
            name="qr"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="mt-1 w-full text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save account"}
        </button>
      </form>
    </div>
  );
}
