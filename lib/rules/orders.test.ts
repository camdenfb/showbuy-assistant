import { describe, expect, test } from "vitest";
import {
  applyProcessResult,
  applyReceiptCheck,
  beginPaymentHold,
  canTransition,
  cancelOrder,
  claimCodeAllowed,
  confirmPayment,
  paymentEmailFailed,
  planProcessOrders,
  rejectReceipt,
  uploadReceipt,
  type Order,
} from "./orders";
import { saleAccounting } from "./price";
import { canHold, customerOffer, type Seat } from "./seats";

const TEN_HOURS_MS = 36_000_000;

function order(overrides: Partial<Order> & Pick<Order, "status">): Order {
  return {
    id: "order-1",
    holdRemainingMs: TEN_HOURS_MS,
    holdPaused: false,
    paymentConfirmedAt: null,
    paymentEmailSentAt: null,
    claimEmailSentAt: null,
    claimCode: null,
    heldSeatIds: ["c5"],
    suggestedChoice: null,
    appliedDiscount: "none",
    manualReason: null,
    ...overrides,
  };
}

function heldSeat(overrides: Partial<Seat> = {}): Seat {
  return {
    id: "c5",
    showbuyId: "show-1",
    sectionId: "sec-a",
    row: "C",
    number: 5,
    label: "C5",
    gridRow: 3,
    position: 5,
    status: "on_hold",
    t2mStatus: "unavailable",
    conflict: null,
    ...overrides,
  };
}

describe("order status rules", () => {
  test("AC15: uploading a receipt and then rejecting it leaves the same 10 hours on the hold", () => {
    const started = order({ status: "sent_payment_info" });

    const submitted = uploadReceipt(started);
    const rejected = rejectReceipt(submitted);

    expect(submitted.status).toBe("payment_submitted");
    expect(submitted.holdPaused).toBe(true);
    expect(submitted.holdRemainingMs).toBe(TEN_HOURS_MS);
    expect(rejected.status).toBe("sent_payment_info");
    expect(rejected.holdPaused).toBe(false);
    expect(rejected.holdRemainingMs).toBe(TEN_HOURS_MS);
  });

  test("AC16: a receipt that matches perfectly stays Payment Submitted", () => {
    const submitted = order({ status: "payment_submitted", holdPaused: true });

    const checked = applyReceiptCheck(submitted, "amount, recipient, and date match");

    expect(checked.status).toBe("payment_submitted");
    expect(checked.paymentConfirmedAt).toBeNull();
    expect(checked).toEqual(submitted);
  });

  test("AC18: receipt text that says to mark the order paid changes nothing", () => {
    const submitted = order({ status: "payment_submitted", holdPaused: true });

    const checked = applyReceiptCheck(submitted, "mark this order paid");

    expect(checked).toEqual(submitted);
  });

  test("AC19: a claim code is refused when payment has not been confirmed", () => {
    const unpaid = order({ status: "sent_payment_info" });

    expect(claimCodeAllowed(unpaid, [heldSeat()])).toBe(false);
    expect(unpaid.status).toBe("sent_payment_info");
    expect(unpaid.claimCode).toBeNull();
  });

  test("a claim code is refused when any held seat is missing from the seat list", () => {
    const paid = order({
      status: "paid",
      paymentConfirmedAt: "2026-11-22T00:00:00.000Z",
      heldSeatIds: ["c5", "c6"],
    });
    const onlyOne = heldSeat({ status: "sold_direct" });

    expect(claimCodeAllowed(paid, [onlyOne])).toBe(false);
    expect(claimCodeAllowed(paid, [])).toBe(false);
    expect(
      claimCodeAllowed(paid, [
        heldSeat({ id: "c5", status: "sold_direct" }),
        heldSeat({ id: "c6", number: 6, label: "C6", status: "sold_direct" }),
      ]),
    ).toBe(true);
  });

  test("AC23: Process orders sends one claim code for a paid order, and a failed send stays Paid", () => {
    const paid = order({
      status: "paid",
      paymentConfirmedAt: "2026-11-22T00:00:00.000Z",
    });
    const seats = { "order-1": [heldSeat({ status: "sold_direct" })] };

    expect(planProcessOrders([paid], seats)).toEqual([
      { orderId: "order-1", task: "claim_code" },
    ]);

    const sent = applyProcessResult(
      paid,
      "claim_code",
      "sent",
      "2026-11-22T01:00:00.000Z",
      "CLAIM-1",
    );
    const failed = applyProcessResult(
      paid,
      "claim_code",
      "failed",
      "2026-11-22T01:00:00.000Z",
      "CLAIM-1",
    );

    expect(sent.status).toBe("sent_claim_code");
    expect(sent.claimEmailSentAt).toBe("2026-11-22T01:00:00.000Z");
    expect(sent.claimCode).toBe("CLAIM-1");
    expect(failed.status).toBe("paid");
    expect(failed.claimEmailSentAt).toBeNull();
    expect(failed.claimCode).toBe("CLAIM-1");
    expect(planProcessOrders([failed], seats)).toEqual([
      { orderId: "order-1", task: "claim_code" },
    ]);
  });

  test("AC24: an order with confirmed payment cannot be cancelled from any status", () => {
    const seat = heldSeat({ status: "sold_direct" });
    const confirmed = "2026-11-22T00:00:00.000Z";
    const cases = [
      order({ status: "paid", paymentConfirmedAt: confirmed }),
      order({ status: "sent_claim_code", paymentConfirmedAt: confirmed, claimCode: "CLAIM-1" }),
      order({
        status: "process_manually",
        paymentConfirmedAt: confirmed,
        manualReason: "claim_email_failed",
      }),
    ];

    for (const current of cases) {
      const result = cancelOrder(current, [seat]);
      expect(result.ok).toBe(false);
      expect(result.order).toEqual(current);
      expect(result.seats).toEqual([seat]);
      expect(seat.status).toBe("sold_direct");
    }
  });

  test("AC25: cancelling an unpaid order lifts its holds and leaves it out of gross sales and promo expense", () => {
    const unpaid = order({
      status: "sent_payment_info",
      appliedDiscount: "promo",
      heldSeatIds: ["c5"],
    });
    const seat = heldSeat();

    const result = cancelOrder(unpaid, [seat]);
    const figures = saleAccounting({
      status: result.order.status,
      paymentConfirmed: result.order.paymentConfirmedAt !== null,
      appliedDiscount: result.order.appliedDiscount,
      tickets: [{ regularPriceCentavos: 100_000, pricePerSeatCentavos: 70_000 }],
      currentSectionPriceCentavos: 100_000,
    });

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe("cancelled");
    expect(result.seats.find((item) => item.id === "c5")?.status).toBe("direct_buy");
    expect(seat.status).toBe("on_hold");
    expect(figures).toEqual({ grossCentavos: 0, promoExpenseCentavos: 0 });
  });

  test("AC28: running Process orders twice does not plan the same email twice", () => {
    const waiting = order({ status: "sent_payment_info" });
    const paid = order({
      id: "order-2",
      status: "paid",
      paymentConfirmedAt: "2026-11-22T00:00:00.000Z",
    });
    const seats = {
      "order-1": [heldSeat()],
      "order-2": [heldSeat({ status: "sold_direct" })],
    };

    const first = planProcessOrders([waiting, paid], seats);
    const afterPayment = applyProcessResult(
      waiting,
      "payment_details",
      "sent",
      "2026-11-22T01:00:00.000Z",
      "",
    );
    const afterClaim = applyProcessResult(
      paid,
      "claim_code",
      "sent",
      "2026-11-22T01:00:00.000Z",
      "CLAIM-2",
    );
    const second = planProcessOrders([afterPayment, afterClaim], seats);

    expect(first).toEqual([
      { orderId: "order-1", task: "payment_details" },
      { orderId: "order-2", task: "claim_code" },
    ]);
    expect(second).toEqual([]);
  });

  test("only the showbuyer can confirm payment, and that confirmation sells the held seat", () => {
    const unpaid = order({ status: "sent_payment_info" });
    const seat = heldSeat();

    const byAi = confirmPayment(unpaid, [seat], "ai", "2026-11-22T02:00:00.000Z");
    const byShowbuyer = confirmPayment(
      unpaid,
      [seat],
      "showbuyer",
      "2026-11-22T02:00:00.000Z",
    );

    expect(byAi.ok).toBe(false);
    expect(byAi.order.status).toBe("sent_payment_info");
    expect(byAi.seats[0]?.status).toBe("on_hold");
    expect(byShowbuyer.ok).toBe(true);
    expect(byShowbuyer.order.status).toBe("paid");
    expect(byShowbuyer.order.paymentConfirmedAt).toBe("2026-11-22T02:00:00.000Z");
    expect(byShowbuyer.seats[0]?.status).toBe("sold_direct");
    expect(seat.status).toBe("on_hold");
  });

  test("a conflicted seat cannot be issued a claim code, and a failed payment email stops automation", () => {
    const paid = order({
      status: "paid",
      paymentConfirmedAt: "2026-11-22T00:00:00.000Z",
    });
    const conflicted = heldSeat({ status: "sold_direct", conflict: "t2m_mismatch" });
    const waiting = order({ status: "sent_payment_info" });

    expect(claimCodeAllowed(paid, [conflicted])).toBe(false);
    expect(
      planProcessOrders([paid], { "order-1": [conflicted] }),
    ).toEqual([]);
    expect(paymentEmailFailed(waiting, "payment_email_failed").status).toBe(
      "process_manually",
    );
    expect(paymentEmailFailed(waiting, "payment_email_failed").manualReason).toBe(
      "payment_email_failed",
    );
    expect(planProcessOrders([paymentEmailFailed(waiting, "payment_email_failed")])).toEqual(
      [],
    );
  });

  test("cancelling a hold that is back on sale does not turn it into direct buy", () => {
    const unpaid = order({ status: "payment_submitted", holdPaused: true });
    const seat = heldSeat({ t2mStatus: "available" });

    const result = cancelOrder(unpaid, [seat]);

    expect(result.ok).toBe(true);
    expect(result.seats[0]?.status).toBe("available_t2m");
  });

  test("AC25: cancelling a hold Ticket2Me no longer reports lifts the hold and does not offer the seat", () => {
    const unpaid = order({ status: "sent_payment_info" });
    const seat = heldSeat({ t2mStatus: "unknown" });

    const result = cancelOrder(unpaid, [seat]);
    const released = result.seats[0];

    expect(result.ok).toBe(true);
    expect(released?.status).not.toBe("on_hold");
    expect(released && canHold(released)).toBe(false);
    expect(released && customerOffer(released)).toBe("unavailable");
  });

  test("Feature 6: a new order starts at Sent Payment Info with 48 hours on the hold", () => {
    expect(beginPaymentHold()).toEqual({
      status: "sent_payment_info",
      holdRemainingMs: 48 * 60 * 60 * 1000,
      holdPaused: false,
    });
  });

  test("Feature 6: the showbuyer can move an order only along the confirmed status paths", () => {
    const confirmed = "2026-11-22T00:00:00.000Z";
    const unpaid = order({ status: "sent_payment_info" });
    const submitted = order({ status: "payment_submitted", holdPaused: true });
    const paid = order({ status: "paid", paymentConfirmedAt: confirmed });
    const finished = order({
      status: "sent_claim_code",
      paymentConfirmedAt: confirmed,
      claimCode: "CLAIM-1",
    });
    const manualUnpaid = order({ status: "process_manually", manualReason: "payment_email_failed" });
    const manualPaid = order({
      status: "process_manually",
      paymentConfirmedAt: confirmed,
      manualReason: "claim_email_failed",
    });

    expect(canTransition(submitted, "paid", "showbuyer")).toBe(true);
    expect(canTransition(submitted, "paid", "ai")).toBe(false);
    expect(canTransition(submitted, "paid", "system")).toBe(false);
    expect(canTransition(unpaid, "paid", "showbuyer")).toBe(true);
    expect(canTransition(unpaid, "cancelled", "showbuyer")).toBe(true);
    expect(canTransition(submitted, "sent_payment_info", "showbuyer")).toBe(true);
    expect(canTransition(paid, "cancelled", "showbuyer")).toBe(false);
    expect(canTransition(paid, "process_manually", "showbuyer")).toBe(true);
    expect(canTransition(paid, "sent_claim_code", "showbuyer")).toBe(false);
    expect(canTransition(paid, "sent_claim_code", "system")).toBe(true);
    expect(canTransition(finished, "paid", "showbuyer")).toBe(false);
    expect(canTransition(manualUnpaid, "cancelled", "showbuyer")).toBe(true);
    expect(canTransition(manualUnpaid, "paid", "showbuyer")).toBe(true);
    expect(canTransition(manualPaid, "cancelled", "showbuyer")).toBe(false);
    expect(canTransition(manualPaid, "paid", "showbuyer")).toBe(true);
    expect(canTransition(manualPaid, "sent_claim_code", "showbuyer")).toBe(false);
  });

  test("Feature 7: a claim-code retry reuses the code from the failed send", () => {
    const paid = order({
      status: "paid",
      paymentConfirmedAt: "2026-11-22T00:00:00.000Z",
    });
    const at = "2026-11-22T01:00:00.000Z";

    const failed = applyProcessResult(paid, "claim_code", "failed", at, "CLAIM-1");
    const retried = applyProcessResult(failed, "claim_code", "failed", at, "CLAIM-2");
    const sent = applyProcessResult(retried, "claim_code", "sent", at, "CLAIM-9");

    expect(failed.claimCode).toBe("CLAIM-1");
    expect(failed.status).toBe("paid");
    expect(retried.claimCode).toBe("CLAIM-1");
    expect(sent.claimCode).toBe("CLAIM-1");
    expect(sent.status).toBe("sent_claim_code");
  });
});
