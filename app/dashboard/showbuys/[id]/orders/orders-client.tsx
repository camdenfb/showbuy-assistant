"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrderStatus } from "@/lib/rules/orders";
import { processOrders, setOrderStatus } from "./actions";

export type OrderCard = {
  id: string;
  status: OrderStatus;
  name: string;
  email: string;
  mobile: string;
  qty: number;
  totalPesos: string;
  rebatePesos: string | null;
  seatLabels: string[];
  holdLabel: string;
  receiptUrl: string | null;
  paymentEmailSent: boolean;
  claimEmailSent: boolean;
  claimCode: string | null;
  promoLabel: string;
  pwdSenior: "yes" | "no";
  allowed: OrderStatus[];
};

type Props = {
  showbuyId: string;
  orders: OrderCard[];
};

/** Spec status names for the unpaid-hold stage after the QR/payment email goes out. */
const STATUS_LABELS: Record<OrderStatus, string> = {
  sent_payment_info: "Payment Info Sent",
  payment_submitted: "Payment Submitted",
  paid: "Paid",
  sent_claim_code: "Sent Claim Code",
  cancelled: "Cancelled",
  process_manually: "Process Order Manually",
};

function statusLabel(status: OrderStatus, current: OrderStatus): string {
  if (status === "sent_payment_info" && current === "payment_submitted") {
    return "Reject receipt";
  }
  if (status === "paid" && current !== "paid") return "Confirm paid";
  return STATUS_LABELS[status];
}

function currentStatusLabel(order: OrderCard): string {
  if (order.status === "sent_payment_info" && !order.paymentEmailSent) {
    return "Order placed — payment email pending";
  }
  return STATUS_LABELS[order.status];
}

export function OrdersClient({ showbuyId, orders }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, OrderStatus | "">>({});

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

      {orders.length === 0 ? (
        <p className="text-sm text-zinc-600">No orders for this showbuy yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2 font-medium">Order</th>
                <th className="px-2 py-2 font-medium">Customer</th>
                <th className="px-2 py-2 font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Seats</th>
                <th className="px-2 py-2 font-medium">Promo</th>
                <th className="px-2 py-2 font-medium">PWD/Senior</th>
                <th className="px-2 py-2 font-medium">Total</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Update</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const chosen = selected[order.id] ?? "";
                return (
                  <tr key={order.id} className="border-b border-zinc-200 align-top">
                    <td className="px-2 py-3">
                      <p className="font-mono text-zinc-900">{order.id.slice(0, 8)}</p>
                      {order.receiptUrl ? (
                        <a
                          href={order.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline"
                        >
                          Receipt
                        </a>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      <p className="text-zinc-900">{order.name}</p>
                      <p className="text-xs text-zinc-700">{order.email}</p>
                      <p className="text-xs text-zinc-500">{order.mobile}</p>
                    </td>
                    <td className="px-2 py-3 text-zinc-800">{order.qty}</td>
                    <td className="px-2 py-3 text-zinc-800">
                      {order.seatLabels.join(", ") || "—"}
                    </td>
                    <td className="px-2 py-3 text-zinc-800">{order.promoLabel}</td>
                    <td className="px-2 py-3 text-zinc-800">{order.pwdSenior}</td>
                    <td className="px-2 py-3">
                      <p className="text-zinc-900">₱{order.totalPesos}</p>
                      {order.rebatePesos ? (
                        <p className="text-xs text-zinc-500">rebate ₱{order.rebatePesos}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-3">
                      <p className="font-medium text-zinc-900">
                        {currentStatusLabel(order)}
                      </p>
                      <p className="text-xs text-zinc-500">{order.holdLabel}</p>
                      {order.status === "sent_payment_info" && order.paymentEmailSent ? (
                        <p className="text-xs text-zinc-500">QR / payment details emailed</p>
                      ) : null}
                      <p className="text-xs text-zinc-500">
                        Claim mail: {order.claimEmailSent ? "sent" : "pending"}
                      </p>
                    </td>
                    <td className="px-2 py-3">
                      {order.allowed.length === 0 ? (
                        <p className="text-xs text-zinc-500">No moves</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <select
                            className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs"
                            value={chosen}
                            disabled={pending}
                            onChange={(event) =>
                              setSelected((prev) => ({
                                ...prev,
                                [order.id]: event.target.value as OrderStatus | "",
                              }))
                            }
                          >
                            <option value="">Select status…</option>
                            {order.allowed.map((status) => (
                              <option key={status} value={status}>
                                {statusLabel(status, order.status)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={pending || !chosen}
                            className="rounded border border-zinc-300 px-2 py-1.5 text-xs disabled:opacity-60"
                            onClick={() => {
                              if (!chosen) return;
                              run(() => setOrderStatus(showbuyId, order.id, chosen));
                            }}
                          >
                            Update status
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
