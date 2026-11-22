import { afterEach, describe, expect, test, vi } from "vitest";
import { clearOutbox, createEmailClient, listOutbox } from "./index";
import { createGmailEmailClient, resetGmailTokenCache } from "./gmail";

const baseEnv = {
  EMAIL_MODE: "gmail",
  GMAIL_CLIENT_ID: "cid",
  GMAIL_CLIENT_SECRET: "csecret",
  GMAIL_REFRESH_TOKEN: "refresh",
  EMAIL_FROM: "Showbuy Assistant <showbuyer@example.test>",
  APP_URL: "https://app.example.test",
};

const payment = {
  to: "buyer@example.test",
  orderId: "ord-1",
  showbuyId: "sb-1",
  orderNumber: "ord-1",
  quantity: 2,
  sectionName: "Heart",
  totalPesos: "5,000",
  paymentLines: ["GCash · Demo · 0000"],
  deadlineManila: "15 Mar 2027, 8:00 pm",
  receiptPath: "/receipt/token",
  rebatePesos: null as string | null,
};

afterEach(() => {
  clearOutbox();
  resetGmailTokenCache();
  vi.unstubAllGlobals();
});

describe("createEmailClient modes", () => {
  test("outbox mode never calls the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createEmailClient({ EMAIL_MODE: "outbox" });
    const result = await client.sendPaymentInfo(payment);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listOutbox()).toHaveLength(1);
  });

  test("missing EMAIL_MODE uses outbox", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createEmailClient({});
    await client.sendPaymentInfo(payment);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listOutbox()[0]?.kind).toBe("payment_info");
  });
});

describe("gmail client", () => {
  test("accepted send posts raw MIME after refreshing the token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "atok", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createGmailEmailClient(baseEnv, fetchMock as unknown as typeof fetch);
    const result = await client.sendPaymentInfo(payment);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenCall = fetchMock.mock.calls[0]!;
    expect(String(tokenCall[0])).toBe("https://oauth2.googleapis.com/token");
    const sendCall = fetchMock.mock.calls[1]!;
    expect(String(sendCall[0])).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const body = JSON.parse(String(sendCall[1]?.body));
    expect(body.raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("Gmail API error returns gmail_error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "atok", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const client = createGmailEmailClient(baseEnv, fetchMock as unknown as typeof fetch);
    expect(await client.sendPaymentInfo(payment)).toEqual({
      ok: false,
      reason: "gmail_error",
    });
  });

  test("revoked refresh token returns gmail_revoked", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    const client = createGmailEmailClient(baseEnv, fetchMock as unknown as typeof fetch);
    expect(await client.sendPaymentInfo(payment)).toEqual({
      ok: false,
      reason: "gmail_revoked",
    });
  });

  test("timeout returns gmail_timeout", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "TimeoutError";
      return Promise.reject(error);
    });
    const client = createGmailEmailClient(baseEnv, fetchMock as unknown as typeof fetch);
    expect(await client.sendPaymentInfo(payment)).toEqual({
      ok: false,
      reason: "gmail_timeout",
    });
  });
});
