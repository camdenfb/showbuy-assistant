"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrderStatus } from "@/lib/rules/orders";
import { processOrders, setOrderStatus } from "./actions";

export type OrderCard = {
  id: string;
  status: OrderStatus;
  customerLabel: string;
  qty: number;
  totalPesos: string;
  rebatePesos: string | null;
  seatLabels: string[];
  holdLabel: string;
  receiptUrl: string | null;
  paymentEmailSent: boolean;
  claimEmailSent: boolean;
  claimCode: string | null;
  allowed: OrderStatus[];
};

type Props = {
  showbuyId: string;
  orders: OrderCard[];
};

export function OrdersClient({ showbuyId, orders }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string; reason?: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? (result.message ?? "Done.") : (result.reason ?? "Failed."));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className="btn-primary rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          onClick={() => run(() => processOrders(showbuyId))}
        >
          {pending ? "Working…" : "Process orders"}
        </button>
        {message ? <p className="text-sm text-zinc-700">{message}</p> : null}
      </div>

      <ul className="space-y-4">
        {orders.map((order) => (
          <li key={order.id} className="rounded border border-zinc-200 p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-zinc-900">
                <span className="font-mono">{order.id.slice(0, 8)}</span> · {order.status}
              </p>
              <p className="text-zinc-600">
                ₱{order.totalPesos}
                {order.rebatePesos ? ` · rebate ₱${order.rebatePesos}` : ""}
              </p>
            </div>
            <p className="mt-1 text-zinc-700">
              {order.customerLabel} · qty {order.qty}
            </p>
            <p className="text-zinc-700">
              Seats: {order.seatLabels.join(", ") || "—"}
            </p>
            <p className="text-zinc-600">{order.holdLabel}</p>
            <p className="text-zinc-600">
              Payment email: {order.paymentEmailSent ? "sent" : "pending"} · Claim email:{" "}
              {order.claimEmailSent ? "sent" : "pending"}
              {order.claimCode ? ` · code on file` : ""}
            </p>
            {order.receiptUrl ? (
              <p className="mt-2">
                <a
                  href={order.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View receipt
                </a>
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {order.allowed.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-60"
                  onClick={() =>
                    run(() => setOrderStatus(showbuyId, order.id, status))
                  }
                >
                  {status === "sent_payment_info" && order.status === "payment_submitted"
                    ? "Reject receipt"
                    : status === "paid"
                      ? "Confirm paid"
                      : status}
                </button>
              ))}
            </div>
          </li>
        ))}
        {orders.length === 0 ? (
          <li className="text-sm text-zinc-600">No orders for this showbuy yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
