import { notFound } from "next/navigation";
import { createTicket2MeClient } from "@/lib/adapters/ticket2me";
import { reconcileShowbuyShared } from "@/lib/reconcile/run-showbuy";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { OrderForm } from "./order-form";

export const instant = false;

type Props = { params: Promise<{ showbuyId: string }> };

const FALLBACK_SECTION_COLORS = [
  "#2563eb",
  "#ca8a04",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#0891b2",
];

export default async function CustomerOrderPage({ params }: Props) {
  const { showbuyId } = await params;
  const supabase = createSupabaseServiceClient();

  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name, event_url, orders_paused, t2m_show_id")
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) notFound();

  // Page loads share an in-flight reconcile; force so interval does not block UX sync.
  await reconcileShowbuyShared(showbuyId, { force: true });

  const { data: showbuyAfter } = await supabase
    .from("showbuys")
    .select("orders_paused")
    .eq("id", showbuyId)
    .maybeSingle();

  const [{ data: sections }, { data: seats }, { data: payments }] = await Promise.all([
    supabase
      .from("sections")
      .select("id, name, regular_price_centavos, is_for_sale, t2m_ticket_type_ids")
      .eq("showbuy_id", showbuyId)
      .order("name"),
    supabase
      .from("seats")
      .select(
        "id, section_id, row_label, seat_number, grid_row, position, status, conflict",
      )
      .eq("showbuy_id", showbuyId),
    supabase
      .from("payment_accounts")
      .select("id, platform, account_name, account_number, qr_code_path")
      .eq("showbuy_id", showbuyId),
  ]);

  const paymentsWithQr = await Promise.all(
    (payments ?? []).map(async (payment) => {
      let qrUrl: string | null = null;
      if (payment.qr_code_path) {
        const { data: signed } = await supabase.storage
          .from("payment-qrs")
          .createSignedUrl(payment.qr_code_path, 60 * 30);
        qrUrl = signed?.signedUrl ?? null;
      }
      return {
        id: payment.id,
        platform: payment.platform,
        account_name: payment.account_name,
        account_number: payment.account_number,
        qrUrl,
      };
    }),
  );

  let ticketColorById: Record<number, string> = {};
  try {
    const tickets = await createTicket2MeClient().fetchShowTickets(showbuy.t2m_show_id);
    ticketColorById = Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket.color]));
  } catch {
    ticketColorById = {};
  }

  const sectionsWithColor = (sections ?? []).map((section, index) => {
    const rawIds = section.t2m_ticket_type_ids;
    const typeIds = Array.isArray(rawIds)
      ? rawIds.filter((id): id is number => typeof id === "number")
      : [];
    const fromTicket = typeIds
      .map((id: number) => ticketColorById[id])
      .find((color): color is string => Boolean(color));
    return {
      id: section.id,
      name: section.name,
      regular_price_centavos: section.regular_price_centavos,
      is_for_sale: section.is_for_sale,
      color: fromTicket ?? FALLBACK_SECTION_COLORS[index % FALLBACK_SECTION_COLORS.length]!,
    };
  });

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-4 py-8 text-zinc-900">
      <OrderForm
        showbuyId={showbuy.id}
        showbuyName={showbuy.name}
        eventUrl={showbuy.event_url}
        ordersPaused={showbuyAfter?.orders_paused ?? showbuy.orders_paused}
        sections={sectionsWithColor}
        seats={(seats ?? []).map((seat) => ({
          id: seat.id,
          label: `${seat.row_label}${seat.seat_number}`,
          sectionId: seat.section_id,
          status: seat.status,
          gridRow: seat.grid_row,
          position: seat.position,
          conflict: seat.conflict,
        }))}
        payments={paymentsWithQr}
      />
      {paymentsWithQr.length === 0 ? (
        <p className="mt-4 text-sm text-amber-800">
          This showbuy has no payment account yet — the showbuyer must add one before orders
          can be held.
        </p>
      ) : null}
    </main>
  );
}
