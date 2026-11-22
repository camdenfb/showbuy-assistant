"use client";

import { useActionState } from "react";
import { uploadReceiptAction, type ReceiptUploadState } from "./actions";

type Props = { token: string; orderNumber: string; status: string };

export function ReceiptForm({ token, orderNumber, status }: Props) {
  const bound = uploadReceiptAction.bind(null, token);
  const [state, formAction, pending] = useActionState<ReceiptUploadState | null, FormData>(
    bound,
    null,
  );

  if (state?.ok) {
    return (
      <p className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        {state.message}
      </p>
    );
  }

  if (status !== "sent_payment_info") {
    return (
      <p className="text-sm text-zinc-700">
        This order is not waiting for a receipt (status: {status}).
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" encType="multipart/form-data">
      <p className="text-sm text-zinc-600">
        Order <span className="font-mono">{orderNumber}</span> — upload a PNG, JPEG or WebP
        up to 4 MB.
      </p>
      <input
        name="receipt"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        required
        className="block w-full text-sm"
      />
      {state && !state.ok ? <p className="text-sm text-red-700">{state.reason}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full rounded bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Upload receipt"}
      </button>
    </form>
  );
}
