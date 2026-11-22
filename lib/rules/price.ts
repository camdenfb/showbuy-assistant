export type DiscountCard = "none" | "pwd" | "senior";
export type AppliedDiscount = "none" | "promo" | "rebate";

export type Promo = {
  code: string;
  active: boolean;
  priceCentavosBySection: Record<string, number>;
  usageLimit: number | null;
  requiresSingleSeat: boolean;
};

export type PricedSeat = {
  sectionId: string;
  regularPriceCentavos: number;
};

export type TicketPrice = {
  regularPriceCentavos: number;
  pricePerSeatCentavos: number;
};

export type PriceQuote =
  | {
      ok: true;
      applied: AppliedDiscount;
      tickets: TicketPrice[];
      totalCentavos: number;
      cardRebateCentavos: number;
    }
  | { ok: false; reason: string };

const CARD_PERCENT = 20;

export function validatePriceCentavos(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 0;
}

export function validateFeePercent(feePercent: number): boolean {
  return Number.isFinite(feePercent) && feePercent >= 0 && feePercent <= 100;
}

export function ticket2meFeeCentavos(
  sales: { status: string; regularPriceCentavos: number }[],
  feePercent: number,
): number | null {
  if (!validateFeePercent(feePercent)) return null;
  if (sales.some((sale) => !validatePriceCentavos(sale.regularPriceCentavos))) return null;

  const soldOnTicket2Me = sales
    .filter((sale) => sale.status === "sold_t2m")
    .reduce((sum, sale) => sum + sale.regularPriceCentavos, 0);

  return Math.round((soldOnTicket2Me * feePercent) / 100);
}

function cardRebateFor(regularPriceCentavos: number): number {
  return Math.round((regularPriceCentavos * CARD_PERCENT) / 100);
}

function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

export function quotePrice(input: {
  seats: PricedSeat[];
  promo: Promo | null;
  enteredCode: string | null;
  discountCard: DiscountCard;
  promoUses: number;
  browserTotalCentavos?: number;
}): PriceQuote {
  if (input.seats.some((seat) => !validatePriceCentavos(seat.regularPriceCentavos))) {
    return { ok: false, reason: "negative_price" };
  }

  const entered = input.enteredCode === null ? "" : normalizeCode(input.enteredCode);
  let promoPrices: number[] | null = null;

  if (entered !== "") {
    const promo = input.promo;
    if (!promo || normalizeCode(promo.code) !== entered) {
      return { ok: false, reason: "unknown_code" };
    }
    if (!promo.active) return { ok: false, reason: "inactive_code" };
    if (promo.usageLimit !== null && input.promoUses >= promo.usageLimit) {
      return { ok: false, reason: "usage_limit" };
    }

    promoPrices = [];
    for (const seat of input.seats) {
      const price = promo.priceCentavosBySection[seat.sectionId];
      if (price === undefined) return { ok: false, reason: "not_valid_for_section" };
      if (!validatePriceCentavos(price)) return { ok: false, reason: "negative_price" };
      promoPrices.push(price);
    }
    if (promo.requiresSingleSeat && input.seats.length !== 1) {
      return { ok: false, reason: "single_one_seat" };
    }
  }

  const cardRebateCentavos =
    input.discountCard === "none"
      ? 0
      : input.seats.reduce(
          (sum, seat) => sum + cardRebateFor(seat.regularPriceCentavos),
          0,
        );

  // Valid promo always wins; rebate is disregarded (never compare savings).
  if (promoPrices) {
    const tickets = input.seats.map((seat, index) => ({
      regularPriceCentavos: seat.regularPriceCentavos,
      pricePerSeatCentavos: promoPrices![index]!,
    }));
    return {
      ok: true,
      applied: "promo",
      tickets,
      totalCentavos: tickets.reduce((sum, ticket) => sum + ticket.pricePerSeatCentavos, 0),
      cardRebateCentavos: 0,
    };
  }

  if (input.discountCard !== "none") {
    const tickets = input.seats.map((seat) => ({
      regularPriceCentavos: seat.regularPriceCentavos,
      pricePerSeatCentavos: seat.regularPriceCentavos,
    }));
    return {
      ok: true,
      applied: "rebate",
      tickets,
      totalCentavos: tickets.reduce((sum, ticket) => sum + ticket.pricePerSeatCentavos, 0),
      cardRebateCentavos,
    };
  }

  const tickets = input.seats.map((seat) => ({
    regularPriceCentavos: seat.regularPriceCentavos,
    pricePerSeatCentavos: seat.regularPriceCentavos,
  }));
  return {
    ok: true,
    applied: "none",
    tickets,
    totalCentavos: tickets.reduce((sum, ticket) => sum + ticket.pricePerSeatCentavos, 0),
    cardRebateCentavos: 0,
  };
}

export function assignPromoUses(
  requests: { id: string }[],
  usageLimit: number | null,
  existingUses: number,
): { id: string; granted: boolean }[] {
  let used = existingUses;
  return requests.map((request) => {
    if (usageLimit !== null && used >= usageLimit) {
      return { id: request.id, granted: false };
    }
    used += 1;
    return { id: request.id, granted: true };
  });
}

export function countPromoUses(
  orders: { appliedDiscount: AppliedDiscount; status: string }[],
): number {
  return orders.filter(
    (order) => order.appliedDiscount === "promo" && order.status !== "cancelled",
  ).length;
}

export function saleAccounting(input: {
  status: string;
  paymentConfirmed: boolean;
  appliedDiscount: AppliedDiscount;
  tickets: TicketPrice[];
  currentSectionPriceCentavos: number;
}): { grossCentavos: number; promoExpenseCentavos: number } {
  if (!input.paymentConfirmed || input.status === "cancelled") {
    return { grossCentavos: 0, promoExpenseCentavos: 0 };
  }

  const grossCentavos = input.tickets.reduce(
    (sum, ticket) => sum + ticket.regularPriceCentavos,
    0,
  );
  const promoExpenseCentavos =
    input.appliedDiscount === "promo"
      ? input.tickets.reduce(
          (sum, ticket) =>
            sum + ticket.regularPriceCentavos - ticket.pricePerSeatCentavos,
          0,
        )
      : 0;

  return { grossCentavos, promoExpenseCentavos };
}

export function profitCentavos(input: {
  grossCentavos: number;
  promoExpenseCentavos: number;
  feesCentavos: number;
  capitalCentavos: number;
  otherExpensesCentavos: number;
  cardRebateCentavos: number;
  deductCardRebates: boolean;
}): number {
  const card = input.deductCardRebates ? input.cardRebateCentavos : 0;
  return (
    input.grossCentavos -
    input.promoExpenseCentavos -
    input.feesCentavos -
    input.capitalCentavos -
    input.otherExpensesCentavos -
    card
  );
}
