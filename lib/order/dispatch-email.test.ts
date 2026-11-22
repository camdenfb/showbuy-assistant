import { describe, expect, test, vi } from "vitest";
import { dispatchOrderEmail } from "./dispatch-email";

function mockSupabase(opts: {
  insertError?: { code: string } | null;
  existing?: { id: string; sent_at: string | null; last_error: string | null } | null;
}) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  return {
    updates,
    inserts,
    client: {
      from(table: string) {
        if (table !== "email_outbox") throw new Error(`unexpected ${table}`);
        return {
          insert(row: unknown) {
            inserts.push(row);
            return {
              select() {
                return {
                  maybeSingle: async () => {
                    if (opts.insertError) {
                      return { data: null, error: opts.insertError };
                    }
                    return {
                      data: { id: "new", sent_at: null },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: opts.existing ?? null,
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
          update(row: unknown) {
            updates.push(row);
            const filter: {
              eq: () => typeof filter;
              then: PromiseLike<{ error: null }>["then"];
            } = {
              eq() {
                return filter;
              },
              then(resolve, reject) {
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return filter;
          },
        };
      },
    },
  };
}

const payment = {
  to: "buyer@example.test",
  orderId: "ord-1",
  showbuyId: "sb-1",
  orderNumber: "ord-1",
  quantity: 1,
  sectionName: "Heart",
  totalPesos: "100",
  paymentLines: ["GCash"],
  deadlineManila: "soon",
  receiptPath: "/receipt/t",
  rebatePesos: null,
};

describe("dispatchOrderEmail", () => {
  test("Process orders run twice does not send twice", async () => {
    const sendPaymentInfo = vi.fn().mockResolvedValue({ ok: true });
    const first = mockSupabase({ insertError: null });
    const firstResult = await dispatchOrderEmail(
      first.client as never,
      { type: "payment_info", email: payment },
      { sendPaymentInfo, sendClaimCode: vi.fn() } as never,
    );
    expect(firstResult).toEqual({ ok: true, emailed: true });
    expect(sendPaymentInfo).toHaveBeenCalledTimes(1);

    const second = mockSupabase({
      insertError: { code: "23505" },
      existing: { id: "row", sent_at: "2027-01-01T00:00:00Z", last_error: null },
    });
    const secondSend = vi.fn().mockResolvedValue({ ok: true });
    const secondResult = await dispatchOrderEmail(
      second.client as never,
      { type: "payment_info", email: payment },
      { sendPaymentInfo: secondSend, sendClaimCode: vi.fn() } as never,
    );
    expect(secondResult).toEqual({ ok: true, emailed: false, skipped: true });
    expect(secondSend).not.toHaveBeenCalled();
  });

  test("failed send stores last_error and does not mark emailed", async () => {
    const db = mockSupabase({ insertError: null });
    const result = await dispatchOrderEmail(
      db.client as never,
      { type: "payment_info", email: payment },
      {
        sendPaymentInfo: vi.fn().mockResolvedValue({ ok: false, reason: "gmail_error" }),
        sendClaimCode: vi.fn(),
      } as never,
    );
    expect(result).toEqual({ ok: false, reason: "gmail_error", emailed: false });
    expect(db.updates.some((row) => (row as { last_error?: string }).last_error === "gmail_error")).toBe(
      true,
    );
  });
});
