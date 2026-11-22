import { inventorySummary, type SaleScope, type Seat } from "./seats";
import {
  profitCentavos,
  saleAccounting,
  ticket2meFeeCentavos,
  type AppliedDiscount,
  type TicketPrice,
} from "./price";

export type AnalyticsOrder = {
  status: string;
  paymentConfirmedAt: string | null;
  appliedDiscount: AppliedDiscount;
  cardRebateCentavos: number;
  tickets: TicketPrice[];
};

export type AnalyticsShowbuy = {
  id: string;
  coverage: "full" | "partial";
  forSaleSectionIds: string[];
  t2mFeePercent: number;
  capitalCentavos: number;
  otherExpensesCentavos: number;
  deductCardRebates: boolean;
  seats: Seat[];
  sectionRegularPriceById: Record<string, number>;
  orders: AnalyticsOrder[];
};

export type AnalyticsReport = {
  ticketsSold: number;
  ticketsToSell: number;
  grossCentavos: number;
  promoExpenseCentavos: number;
  feesCentavos: number;
  cardRebateCentavos: number;
  capitalCentavos: number;
  otherExpensesCentavos: number;
  profitCentavos: number;
  roi: number | null;
};

function scopeFor(showbuy: AnalyticsShowbuy): SaleScope {
  if (showbuy.coverage === "partial") {
    return { coverage: "partial", sectionIds: showbuy.forSaleSectionIds };
  }
  return { coverage: "full", sectionIds: [] };
}

function t2mGrossForSeat(
  seat: Seat,
  sectionRegularPriceById: Record<string, number>,
  importedSalePriceCentavos: number | null | undefined,
): number {
  if (importedSalePriceCentavos != null && importedSalePriceCentavos >= 0) {
    return importedSalePriceCentavos;
  }
  return sectionRegularPriceById[seat.sectionId] ?? 0;
}

export type SeatSalePrice = {
  seatId: string;
  importedSalePriceCentavos: number | null;
};

export function computeShowbuyAnalytics(
  showbuy: AnalyticsShowbuy,
  seatSalePrices: SeatSalePrice[] = [],
): AnalyticsReport {
  const scope = scopeFor(showbuy);
  const summary = inventorySummary(showbuy.seats, scope);
  const ticketsSold = summary.counts.sold_direct + summary.counts.sold_t2m;
  const ticketsToSell =
    summary.counts.available_t2m +
    summary.counts.pullout_pending +
    summary.counts.direct_buy +
    summary.counts.on_hold;

  const priceBySeatId = Object.fromEntries(
    seatSalePrices.map((row) => [row.seatId, row.importedSalePriceCentavos]),
  );

  let grossCentavos = 0;
  let promoExpenseCentavos = 0;
  let cardRebateCentavos = 0;

  for (const order of showbuy.orders) {
    const paymentConfirmed = order.paymentConfirmedAt !== null;
    const figures = saleAccounting({
      status: order.status,
      paymentConfirmed,
      appliedDiscount: order.appliedDiscount,
      tickets: order.tickets,
      currentSectionPriceCentavos: 0,
    });
    grossCentavos += figures.grossCentavos;
    promoExpenseCentavos += figures.promoExpenseCentavos;
    if (
      paymentConfirmed &&
      order.status !== "cancelled" &&
      order.appliedDiscount !== "promo"
    ) {
      cardRebateCentavos += order.cardRebateCentavos;
    }
  }

  let t2mGrossCentavos = 0;
  const feeSales: { status: string; regularPriceCentavos: number }[] = [];
  for (const seat of showbuy.seats) {
    if (seat.status !== "sold_t2m") continue;
    if (scope.coverage === "partial" && !scope.sectionIds.includes(seat.sectionId)) {
      continue;
    }
    const price = t2mGrossForSeat(
      seat,
      showbuy.sectionRegularPriceById,
      priceBySeatId[seat.id],
    );
    t2mGrossCentavos += price;
    feeSales.push({ status: "sold_t2m", regularPriceCentavos: price });
  }
  grossCentavos += t2mGrossCentavos;

  const feesCentavos = ticket2meFeeCentavos(feeSales, showbuy.t2mFeePercent) ?? 0;

  const profit = profitCentavos({
    grossCentavos,
    promoExpenseCentavos,
    feesCentavos,
    capitalCentavos: showbuy.capitalCentavos,
    otherExpensesCentavos: showbuy.otherExpensesCentavos,
    cardRebateCentavos,
    deductCardRebates: showbuy.deductCardRebates,
  });

  const invested = showbuy.capitalCentavos + showbuy.otherExpensesCentavos;
  const roi = invested === 0 ? null : profit / invested;

  return {
    ticketsSold,
    ticketsToSell,
    grossCentavos,
    promoExpenseCentavos,
    feesCentavos,
    cardRebateCentavos,
    capitalCentavos: showbuy.capitalCentavos,
    otherExpensesCentavos: showbuy.otherExpensesCentavos,
    profitCentavos: profit,
    roi,
  };
}

export function combineAnalytics(reports: AnalyticsReport[]): AnalyticsReport {
  const combined = reports.reduce(
    (acc, report) => ({
      ticketsSold: acc.ticketsSold + report.ticketsSold,
      ticketsToSell: acc.ticketsToSell + report.ticketsToSell,
      grossCentavos: acc.grossCentavos + report.grossCentavos,
      promoExpenseCentavos: acc.promoExpenseCentavos + report.promoExpenseCentavos,
      feesCentavos: acc.feesCentavos + report.feesCentavos,
      cardRebateCentavos: acc.cardRebateCentavos + report.cardRebateCentavos,
      capitalCentavos: acc.capitalCentavos + report.capitalCentavos,
      otherExpensesCentavos: acc.otherExpensesCentavos + report.otherExpensesCentavos,
      profitCentavos: acc.profitCentavos + report.profitCentavos,
      roi: null as number | null,
    }),
    {
      ticketsSold: 0,
      ticketsToSell: 0,
      grossCentavos: 0,
      promoExpenseCentavos: 0,
      feesCentavos: 0,
      cardRebateCentavos: 0,
      capitalCentavos: 0,
      otherExpensesCentavos: 0,
      profitCentavos: 0,
      roi: null as number | null,
    },
  );

  const invested = combined.capitalCentavos + combined.otherExpensesCentavos;
  combined.roi = invested === 0 ? null : combined.profitCentavos / invested;
  return combined;
}
