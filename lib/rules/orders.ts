import { markSoldDirect, releaseHeldSeats, type Seat } from "./seats";

export type OrderStatus =
  | "sent_payment_info"
  | "payment_submitted"
  | "paid"
  | "sent_claim_code"
  | "cancelled"
  | "process_manually";

export type Order = {
  id: string;
  status: OrderStatus;
  holdRemainingMs: number;
  holdPaused: boolean;
  paymentConfirmedAt: string | null;
  paymentEmailSentAt: string | null;
  claimEmailSentAt: string | null;
  claimCode: string | null;
  heldSeatIds: string[];
  suggestedChoice: string[] | null;
  appliedDiscount: "none" | "promo" | "rebate";
  manualReason: string | null;
};

export type EmailTask = "payment_details" | "claim_code";
export type Actor = "showbuyer" | "ai" | "system";

export const PAYMENT_HOLD_MS = 48 * 60 * 60 * 1000;

const SHOWBUYER_MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  sent_payment_info: ["payment_submitted", "cancelled", "process_manually", "paid"],
  payment_submitted: ["paid", "sent_payment_info", "cancelled", "process_manually"],
  paid: ["process_manually"],
  sent_claim_code: [],
  cancelled: [],
  process_manually: ["sent_payment_info", "payment_submitted", "cancelled", "paid"],
};

export function beginPaymentHold(): {
  status: "sent_payment_info";
  holdRemainingMs: number;
  holdPaused: false;
} {
  return {
    status: "sent_payment_info",
    holdRemainingMs: PAYMENT_HOLD_MS,
    holdPaused: false,
  };
}

export function canTransition(order: Order, to: OrderStatus, actor: Actor): boolean {
  if (actor === "ai" || to === order.status) return false;
  if (order.paymentConfirmedAt !== null && to === "cancelled") return false;

  if (actor === "system") {
    if (
      order.status === "sent_payment_info" &&
      (to === "payment_submitted" || to === "process_manually")
    ) {
      return true;
    }
    return (
      order.status === "paid" && to === "sent_claim_code" && order.paymentConfirmedAt !== null
    );
  }

  if (order.status === "process_manually" && order.paymentConfirmedAt !== null) {
    return to === "paid";
  }

  return SHOWBUYER_MOVES[order.status].includes(to);
}

export function uploadReceipt(order: Order): Order {
  if (order.status !== "sent_payment_info") return order;
  return { ...order, status: "payment_submitted", holdPaused: true };
}

export function rejectReceipt(order: Order): Order {
  if (order.status !== "payment_submitted") return order;
  return { ...order, status: "sent_payment_info", holdPaused: false };
}

export function applyReceiptCheck(order: Order, note: string): Order {
  void note;
  return order;
}

export function confirmPayment(
  order: Order,
  seats: Seat[],
  actor: Actor,
  at: string,
): { ok: boolean; order: Order; seats: Seat[] } {
  if (!canTransition(order, "paid", actor)) return { ok: false, order, seats };

  return {
    ok: true,
    order: {
      ...order,
      status: "paid",
      paymentConfirmedAt: order.paymentConfirmedAt ?? at,
    },
    seats: markSoldDirect(seats, order.heldSeatIds),
  };
}

export function claimCodeAllowed(order: Order, seats: Seat[]): boolean {
  if (order.status !== "paid" || order.paymentConfirmedAt === null) return false;
  if (order.heldSeatIds.length === 0) return false;
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  return order.heldSeatIds.every((id) => {
    const seat = byId.get(id);
    return seat !== undefined && seat.conflict === null;
  });
}

export function planProcessOrders(
  orders: Order[],
  seatsByOrderId: Record<string, Seat[]> = {},
): { orderId: string; task: EmailTask }[] {
  const tasks: { orderId: string; task: EmailTask }[] = [];
  for (const order of orders) {
    if (order.status === "sent_payment_info" && order.paymentEmailSentAt === null) {
      tasks.push({ orderId: order.id, task: "payment_details" });
    } else if (
      order.status === "paid" &&
      order.claimEmailSentAt === null &&
      claimCodeAllowed(order, seatsByOrderId[order.id] ?? [])
    ) {
      tasks.push({ orderId: order.id, task: "claim_code" });
    }
  }
  return tasks;
}

export function applyProcessResult(
  order: Order,
  task: EmailTask,
  result: "sent" | "failed",
  at: string,
  claimCode: string,
): Order {
  if (task === "payment_details") {
    if (order.status !== "sent_payment_info" || order.paymentEmailSentAt !== null) {
      return order;
    }
    if (result === "failed") {
      return {
        ...order,
        status: "process_manually",
        manualReason: "payment_email_failed",
      };
    }
    return { ...order, paymentEmailSentAt: at };
  }

  if (order.status !== "paid" || order.claimEmailSentAt !== null) return order;
  const claimCodeToKeep = order.claimCode ?? claimCode;
  if (result === "failed") return { ...order, claimCode: claimCodeToKeep };
  if (!canTransition(order, "sent_claim_code", "system")) return order;
  return {
    ...order,
    status: "sent_claim_code",
    claimEmailSentAt: at,
    claimCode: claimCodeToKeep,
  };
}

export function cancelOrder(
  order: Order,
  seats: Seat[],
): { ok: boolean; order: Order; seats: Seat[] } {
  if (!canTransition(order, "cancelled", "showbuyer")) {
    return { ok: false, order, seats };
  }

  return {
    ok: true,
    order: { ...order, status: "cancelled" },
    seats: releaseHeldSeats(seats, order.heldSeatIds),
  };
}

export function paymentEmailFailed(order: Order, reason: string): Order {
  if (order.paymentEmailSentAt !== null) return order;
  return { ...order, status: "process_manually", manualReason: reason };
}
