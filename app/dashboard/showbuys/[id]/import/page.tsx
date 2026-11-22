import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { createTicket2MeClient } from "@/lib/adapters/ticket2me";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import {
  ticketTypesFromCells,
  type UnavailableClass,
} from "@/lib/rules/import-map";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ImportForm } from "./import-form";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> };

const CLASSIFICATIONS = new Set<UnavailableClass>([
  "house",
  "direct_buy",
  "sold_direct",
  "sold_t2m",
]);

export default async function ImportSeatMapPage({ params, searchParams }: Props) {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const { id } = await params;
  const query = await searchParams;
  const supabase = createSupabaseServiceClient();
  const { data: showbuy } = await supabase
    .from("showbuys")
    .select("id, name, t2m_show_id, coverage")
    .eq("id", id)
    .maybeSingle();
  if (!showbuy) redirect("/dashboard");
  const coverage = showbuy.coverage === "partial" ? "partial" : "full";

  const { data: existingSections } = await supabase
    .from("sections")
    .select("id, name, regular_price_centavos, t2m_ticket_type_ids, is_for_sale")
    .eq("showbuy_id", id);

  const { count: seatCount } = await supabase
    .from("seats")
    .select("id", { count: "exact", head: true })
    .eq("showbuy_id", id);

  const { data: existingSeats } = await supabase
    .from("seats")
    .select("t2m_seat_id, status")
    .eq("showbuy_id", id);

  const savedClassifications: Record<number, UnavailableClass> = {};
  for (const seat of existingSeats ?? []) {
    if (CLASSIFICATIONS.has(seat.status as UnavailableClass)) {
      savedClassifications[seat.t2m_seat_id] = seat.status as UnavailableClass;
    }
  }

  const client = createTicket2MeClient();
  const [feed, tickets] = await Promise.all([
    client.fetchSeatPlan(showbuy.t2m_show_id),
    client.fetchShowTickets(showbuy.t2m_show_id),
  ]);
  const types = ticketTypesFromCells(feed);
  const ticketMetaById = Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket]));

  const seats = feed.flatMap((row) =>
    row.seats
      .filter((seat) => seat.seat_no !== "EMPTY")
      .map((seat) => ({
        seatId: seat.seat_id,
        label: seat.seat_no,
        ticketTypeId: seat.ticket_id,
        t2mStatus: seat.status,
      })),
  );

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: showbuy.name },
          { label: "Inventory" },
        ]}
      />
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">Inventory</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Coverage: {coverage}
        {coverage === "full"
          ? " — every section is for sale."
          : " — only sections marked for sale can be sold."}{" "}
        Change coverage in{" "}
        <Link className="underline" href={`/dashboard/showbuys/${id}/settings`}>
          settings
        </Link>
        .
      </p>
      {query.saved ? (
        <p className="mt-4 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Seat map saved. Next:{" "}
          <Link className="underline" href={`/dashboard/showbuys/${id}/payments`}>
            payment accounts
          </Link>
          .
        </p>
      ) : null}
      <ImportForm
        showbuyId={id}
        ticketTypes={types}
        ticketMetaById={ticketMetaById}
        existingSections={existingSections ?? []}
        seats={seats}
        savedClassifications={savedClassifications}
        hasExistingSeats={(seatCount ?? 0) > 0}
        feedPreview={feed}
        coverage={coverage}
      />
    </main>
  );
}
