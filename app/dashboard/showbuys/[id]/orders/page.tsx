import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { canTransition, type OrderStatus } from "@/lib/rules/orders";
import { mapDbOrder } from "@/lib/order/map-order";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { OrdersClient, type OrderCard } from "./orders-client";

type Props = { params: Promise<{ id: string }> };

const ALL_STATUSES: OrderStatus[] = [
  "sent_payment_info",
  "payment_submitted",
  "paid",
  "sent_claim_code",
  "cancelled",
  "process_manually",
];

export default async function OrdersPage({ params }: Props) {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const { id } = await params;
  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!showbuy) redirect("/dashboard");

  const { data: orderRows } = await supabase
    .from("orders")
    .select(
      "id, status, hold_expires_at, payment_confirmed_at, payment_email_sent_at, claim_email_sent_at, claim_code, held_seat_ids, suggested_choice_seat_ids, applied_discount, discount_card, promo_code, manual_reason, total_centavos, card_rebate_centavos, qty, name, email, mobile",
    )
    .eq("showbuy_id", id)
    .order("created_at", { ascending: false });

  const heldIds = [...new Set((orderRows ?? []).flatMap((row) => row.held_seat_ids ?? []))];
  const { data: seatRows } =
    heldIds.length > 0
      ? await supabase
          .from("seats")
          .select("id, row_label, seat_number")
          .in("id", heldIds)
      : { data: [] as { id: string; row_label: string; seat_number: number }[] };

  const seatLabelById = Object.fromEntries(
    (seatRows ?? []).map((seat) => [seat.id, `${seat.row_label}${seat.seat_number}`]),
  );

  const orderIds = (orderRows ?? []).map((row) => row.id);
  const { data: receipts } =
    orderIds.length > 0
      ? await supabase
          .from("receipts")
          .select("order_id, file_path, uploaded_at")
          .in("order_id", orderIds)
          .order("uploaded_at", { ascending: false })
      : { data: [] as { order_id: string; file_path: string; uploaded_at: string }[] };

  const latestReceiptByOrder = new Map<string, string>();
  for (const receipt of receipts ?? []) {
    if (!latestReceiptByOrder.has(receipt.order_id)) {
      latestReceiptByOrder.set(receipt.order_id, receipt.file_path);
    }
  }

  const cards: OrderCard[] = [];
  for (const row of orderRows ?? []) {
    const order = mapDbOrder(row, Date.now());
    const path = latestReceiptByOrder.get(row.id);
    let receiptUrl: string | null = null;
    if (path) {
      const { data: signed } = await supabase.storage
        .from("receipts")
        .createSignedUrl(path, 60 * 30);
      receiptUrl = signed?.signedUrl ?? null;
    }

    const hours = Math.floor(order.holdRemainingMs / (60 * 60 * 1000));
    const mins = Math.floor((order.holdRemainingMs % (60 * 60 * 1000)) / (60 * 1000));
    const holdLabel = order.holdPaused
      ? `Hold paused (${hours}h ${mins}m remaining)`
      : `Hold ${hours}h ${mins}m remaining`;

    const promoCode =
      typeof row.promo_code === "string" && row.promo_code.trim().length > 0
        ? row.promo_code.trim()
        : null;
    const pwdSenior =
      row.discount_card === "pwd" || row.discount_card === "senior" ? "yes" : "no";

    cards.push({
      id: row.id,
      status: order.status,
      name: row.name,
      email: row.email,
      mobile: row.mobile,
      qty: row.qty,
      totalPesos: (row.total_centavos / 100).toLocaleString("en-PH"),
      rebatePesos:
        row.card_rebate_centavos > 0
          ? (row.card_rebate_centavos / 100).toLocaleString("en-PH")
          : null,
      seatLabels: ((row.held_seat_ids ?? []) as string[]).map(
        (seatId) => seatLabelById[seatId] ?? seatId.slice(0, 6),
      ),
      holdLabel,
      receiptUrl,
      paymentEmailSent: order.paymentEmailSentAt !== null,
      claimEmailSent: order.claimEmailSentAt !== null,
      claimCode: order.claimCode,
      promoLabel: promoCode ?? "none",
      pwdSenior,
      allowed: ALL_STATUSES.filter((status) => canTransition(order, status, "showbuyer")),
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: showbuy.name },
          { label: "Orders" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold">Orders</h1>
      <p className="mt-1 text-sm text-zinc-600">{showbuy.name}</p>
      <div className="mt-8">
        <OrdersClient showbuyId={id} orders={cards} />
      </div>
    </main>
  );
}
