import { pushOutbox, type OutboxMessage } from "./outbox";

export type PaymentInfoEmail = {
  to: string;
  orderId: string;
  showbuyId: string;
  orderNumber: string;
  quantity: number;
  sectionName: string;
  totalPesos: string;
  paymentLines: string[];
  deadlineManila: string;
  receiptPath: string;
  rebatePesos: string | null;
};

export type ClaimCodeEmail = {
  to: string;
  orderId: string;
  showbuyId: string;
  orderNumber: string;
  claimCode: string;
  seatLabels: string[];
  sectionName: string;
  rebatePesos: string | null;
};

export type EmailClient = {
  sendPaymentInfo: (
    email: PaymentInfoEmail,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
  sendClaimCode: (
    email: ClaimCodeEmail,
  ) => Promise<{ ok: true } | { ok: false; reason: string }>;
};

export function createDemoEmailClient(): EmailClient {
  return {
    async sendPaymentInfo(email) {
      const body = [
        `Order ${email.orderNumber}`,
        `Qty ${email.quantity} · ${email.sectionName}`,
        `Total ₱${email.totalPesos}`,
        email.rebatePesos
          ? `Show-day rebate ₱${email.rebatePesos} — bring your card.`
          : null,
        `Pay by ${email.deadlineManila}`,
        ...email.paymentLines,
        `Receipt upload: ${email.receiptPath}`,
      ]
        .filter(Boolean)
        .join("\n");

      pushOutbox({
        kind: "payment_info",
        to: email.to,
        subject: `Payment details for order ${email.orderNumber}`,
        body,
        orderId: email.orderId,
        showbuyId: email.showbuyId,
      });
      return { ok: true };
    },
    async sendClaimCode(email) {
      const body = [
        `Order ${email.orderNumber}`,
        `Claim code: ${email.claimCode}`,
        `Seats: ${email.seatLabels.join(", ")}`,
        `Section: ${email.sectionName}`,
        email.rebatePesos
          ? `Show-day rebate ₱${email.rebatePesos} — bring your card.`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      pushOutbox({
        kind: "claim_code",
        to: email.to,
        subject: `Claim code for order ${email.orderNumber}`,
        body,
        orderId: email.orderId,
        showbuyId: email.showbuyId,
      });
      return { ok: true };
    },
  };
}

/** Live Resend path deferred; demo outbox until slice needs it. */
export function createEmailClient(
  env: Record<string, string | undefined> = process.env,
): EmailClient {
  void env;
  return createDemoEmailClient();
}

export type { OutboxMessage };
export { listOutbox, clearOutbox } from "./outbox";
