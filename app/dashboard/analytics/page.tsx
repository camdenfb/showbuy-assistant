import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  combineAnalytics,
  computeShowbuyAnalytics,
  type AnalyticsOrder,
  type AnalyticsShowbuy,
} from "@/lib/rules/analytics";
import type { AppliedDiscount } from "@/lib/rules/price";
import { requireShowbuyer } from "@/lib/auth/require-showbuyer";
import { mapDbSeat } from "@/lib/order/map-seat";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ showbuy?: string }> };

function pesos(centavos: number): string {
  return (centavos / 100).toLocaleString("en-PH");
}

function parseExpenses(raw: unknown): { label: string; amountCentavos: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { label?: unknown; amountCentavos?: unknown };
      if (typeof row.label !== "string" || typeof row.amountCentavos !== "number") {
        return null;
      }
      return { label: row.label, amountCentavos: row.amountCentavos };
    })
    .filter((item): item is { label: string; amountCentavos: number } => item !== null);
}

function parseTickets(raw: unknown): AnalyticsOrder["tickets"] {
  if (!raw || typeof raw !== "object") return [];
  const tickets = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { tickets?: unknown }).tickets)
      ? ((raw as { tickets: unknown[] }).tickets)
      : [];
  return tickets
    .map((ticket) => {
      if (!ticket || typeof ticket !== "object") return null;
      const row = ticket as {
        regularPriceCentavos?: unknown;
        pricePerSeatCentavos?: unknown;
      };
      if (
        typeof row.regularPriceCentavos !== "number" ||
        typeof row.pricePerSeatCentavos !== "number"
      ) {
        return null;
      }
      return {
        regularPriceCentavos: row.regularPriceCentavos,
        pricePerSeatCentavos: row.pricePerSeatCentavos,
      };
    })
    .filter((item): item is AnalyticsOrder["tickets"][number] => item !== null);
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const auth = await requireShowbuyer();
  if (!auth.ok) redirect("/login");

  const query = await searchParams;
  const supabase = createSupabaseServiceClient();
  const { data: showbuys } = await supabase
    .from("showbuys")
    .select(
      "id, name, coverage, t2m_fee_percent, capital_investment_centavos, other_expenses, deduct_card_rebates",
    )
    .order("starts_at");

  const selectedId = query.showbuy ?? "all";
  const selectedShowbuy =
    selectedId === "all"
      ? null
      : (showbuys ?? []).find((showbuy) => showbuy.id === selectedId) ?? null;

  const reports = [];
  const financePayloads: {
    id: string;
    name: string;
    feePercent: number;
    capitalCentavos: number;
    otherExpenses: { label: string; amountCentavos: number }[];
    deductCardRebates: boolean;
  }[] = [];

  for (const showbuy of showbuys ?? []) {
    const [{ data: sections }, { data: seats }, { data: orders }] = await Promise.all([
      supabase
        .from("sections")
        .select("id, regular_price_centavos, is_for_sale")
        .eq("showbuy_id", showbuy.id),
      supabase
        .from("seats")
        .select(
          "id, showbuy_id, section_id, row_label, seat_number, grid_row, position, status, t2m_status, conflict, imported_sale_price_centavos",
        )
        .eq("showbuy_id", showbuy.id),
      supabase
        .from("orders")
        .select(
          "status, payment_confirmed_at, applied_discount, card_rebate_centavos, tickets",
        )
        .eq("showbuy_id", showbuy.id),
    ]);

    const forSaleSectionIds = (sections ?? [])
      .filter((section) => section.is_for_sale !== false)
      .map((section) => section.id);

    const sectionRegularPriceById = Object.fromEntries(
      (sections ?? []).map((section) => [section.id, section.regular_price_centavos]),
    );

    const mappedSeats = (seats ?? []).map((row) =>
      mapDbSeat({
        id: row.id,
        showbuy_id: row.showbuy_id,
        section_id: row.section_id,
        row_label: row.row_label,
        seat_number: row.seat_number,
        grid_row: row.grid_row,
        position: row.position,
        status: row.status,
        t2m_status: row.t2m_status,
        conflict: row.conflict,
      }),
    );

    const expenses = parseExpenses(showbuy.other_expenses);
    const otherExpensesCentavos = expenses.reduce(
      (sum, item) => sum + item.amountCentavos,
      0,
    );

    const analyticsShowbuy: AnalyticsShowbuy = {
      id: showbuy.id,
      coverage: showbuy.coverage === "partial" ? "partial" : "full",
      forSaleSectionIds,
      t2mFeePercent: Number(showbuy.t2m_fee_percent),
      capitalCentavos: showbuy.capital_investment_centavos,
      otherExpensesCentavos,
      deductCardRebates: showbuy.deduct_card_rebates,
      seats: mappedSeats,
      sectionRegularPriceById,
      orders: (orders ?? []).map((order) => ({
        status: order.status,
        paymentConfirmedAt: order.payment_confirmed_at,
        appliedDiscount: order.applied_discount as AppliedDiscount,
        cardRebateCentavos: order.card_rebate_centavos,
        tickets: parseTickets(order.tickets),
      })),
    };

    const seatSalePrices = (seats ?? []).map((row) => ({
      seatId: row.id,
      importedSalePriceCentavos: row.imported_sale_price_centavos,
    }));

    reports.push({
      id: showbuy.id,
      name: showbuy.name,
      report: computeShowbuyAnalytics(analyticsShowbuy, seatSalePrices),
    });
    financePayloads.push({
      id: showbuy.id,
      name: showbuy.name,
      feePercent: Number(showbuy.t2m_fee_percent),
      capitalCentavos: showbuy.capital_investment_centavos,
      otherExpenses: expenses,
      deductCardRebates: showbuy.deduct_card_rebates,
    });
  }

  const view =
    selectedId === "all" || !selectedShowbuy
      ? {
          title: "All showbuys",
          report: combineAnalytics(reports.map((item) => item.report)),
          finance: null as (typeof financePayloads)[number] | null,
        }
      : {
          title: selectedShowbuy.name,
          report:
            reports.find((item) => item.id === selectedShowbuy.id)?.report ??
            combineAnalytics([]),
          finance: financePayloads.find((item) => item.id === selectedShowbuy.id) ?? null,
        };

  const { report } = view;

  const crumbs =
    selectedId === "all" || !selectedShowbuy
      ? [
          { label: "Dashboard", href: "/dashboard" },
          { label: "Analytics" },
        ]
      : [
          { label: "Dashboard", href: "/dashboard" },
          { label: "Analytics", href: "/dashboard/analytics" },
          { label: selectedShowbuy.name },
        ];

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-12 text-zinc-900">
      <Breadcrumbs items={crumbs} />
      <h1 className="mt-4 text-2xl font-semibold">Analytics</h1>

      <div className="mt-6">
        <p className="text-sm text-zinc-600">Showbuy</p>
        <AnalyticsSwitcher current={selectedId} showbuys={showbuys ?? []} />
      </div>

      <h2 className="mt-8 text-lg font-medium">{view.title}</h2>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric label="Tickets sold" value={String(report.ticketsSold)} />
        <Metric label="Tickets to sell" value={String(report.ticketsToSell)} />
        <Metric label="Gross sales" value={`₱${pesos(report.grossCentavos)}`} />
        <Metric label="Promo expense" value={`₱${pesos(report.promoExpenseCentavos)}`} />
        <Metric label="Ticket2Me fees" value={`₱${pesos(report.feesCentavos)}`} />
        <Metric label="Card rebates" value={`₱${pesos(report.cardRebateCentavos)}`} />
        <Metric label="Capital" value={`₱${pesos(report.capitalCentavos)}`} />
        <Metric label="Other expenses" value={`₱${pesos(report.otherExpensesCentavos)}`} />
        <Metric label="Profit" value={`₱${pesos(report.profitCentavos)}`} />
        <Metric
          label="ROI"
          value={report.roi == null ? "—" : `${(report.roi * 100).toFixed(1)}%`}
        />
      </dl>

      {view.finance ? (
        <section className="mt-8 border-t border-zinc-200 pt-6 text-sm">
          <h2 className="text-lg font-medium">Finance settings used</h2>
          <dl className="mt-3 space-y-1 text-zinc-700">
            <div>
              Ticket2Me fee: {view.finance.feePercent}%
            </div>
            <div>
              Capital: ₱{pesos(view.finance.capitalCentavos)}
            </div>
            <div>
              Other expenses:{" "}
              {view.finance.otherExpenses.length === 0
                ? "none"
                : view.finance.otherExpenses
                    .map(
                      (item) =>
                        `${item.label} ₱${pesos(item.amountCentavos)}`,
                    )
                    .join(", ")}
            </div>
            <div>
              Deduct card rebates: {view.finance.deductCardRebates ? "yes" : "no"}
            </div>
          </dl>
          <p className="mt-3">
            <Link
              href={`/dashboard/showbuys/${view.finance.id}/settings`}
              className="underline"
            >
              Edit in settings
            </Link>
          </p>
        </section>
      ) : (
        <p className="mt-6 text-sm text-zinc-600">
          Select one showbuy to see fee, capital, expenses, and rebate settings.
        </p>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-medium">{value}</dd>
    </div>
  );
}

function AnalyticsSwitcher({
  current,
  showbuys,
}: {
  current: string;
  showbuys: { id: string; name: string }[];
}) {
  return (
    <p className="mt-2 flex flex-wrap gap-3 text-sm">
      <Link
        href="/dashboard/analytics"
        className={current === "all" ? "font-semibold underline" : "underline"}
      >
        All
      </Link>
      {showbuys.map((showbuy) => (
        <Link
          key={showbuy.id}
          href={`/dashboard/analytics?showbuy=${showbuy.id}`}
          className={current === showbuy.id ? "font-semibold underline" : "underline"}
        >
          {showbuy.name}
        </Link>
      ))}
    </p>
  );
}
