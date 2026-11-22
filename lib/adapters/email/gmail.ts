import {
  buildMimeMessage,
  escapeHtml,
  toBase64Url,
} from "@/lib/rules/email-safe";
import type { ClaimCodeEmail, EmailClient, PaymentInfoEmail } from "./index";

type EnvBag = Record<string, string | undefined>;

type TokenCache = { accessToken: string; expiresAtMs: number };

let tokenCache: TokenCache | null = null;

export function resetGmailTokenCache(): void {
  tokenCache = null;
}

function requireGmailEnv(env: EnvBag): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
  appUrl: string;
} {
  const clientId = env.GMAIL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GMAIL_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GMAIL_REFRESH_TOKEN?.trim() ?? "";
  const from = env.EMAIL_FROM?.trim() ?? "";
  const appUrl = (env.APP_URL?.trim() ?? "").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !refreshToken || !from || !appUrl) {
    throw new Error("gmail_misconfigured");
  }
  return { clientId, clientSecret, refreshToken, from, appUrl };
}

function receiptUrl(appUrl: string, receiptPath: string): string {
  if (receiptPath.startsWith("http://") || receiptPath.startsWith("https://")) {
    return receiptPath;
  }
  const path = receiptPath.startsWith("/") ? receiptPath : `/${receiptPath}`;
  return `${appUrl}${path}`;
}

async function refreshAccessToken(
  env: ReturnType<typeof requireGmailEnv>,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (tokenCache && tokenCache.expiresAtMs - 60_000 > nowMs) {
    return { ok: true, token: tokenCache.accessToken };
  }

  let response: Response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.clientId,
        client_secret: env.clientSecret,
        refresh_token: env.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return { ok: false, reason: "gmail_timeout" };
    }
    return { ok: false, reason: "gmail_error" };
  }

  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  } | null;

  if (!response.ok) {
    if (payload?.error === "invalid_grant" || response.status === 401) {
      return { ok: false, reason: "gmail_revoked" };
    }
    return { ok: false, reason: "gmail_error" };
  }

  const accessToken = payload?.access_token?.trim() ?? "";
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { ok: false, reason: "gmail_error" };
  }

  tokenCache = {
    accessToken,
    expiresAtMs: nowMs + expiresIn * 1000,
  };
  return { ok: true, token: accessToken };
}

async function sendRaw(
  accessToken: string,
  raw: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetchImpl(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: toBase64Url(raw) }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return { ok: false, reason: "gmail_timeout" };
    }
    return { ok: false, reason: "gmail_error" };
  }

  if (response.status === 401) {
    resetGmailTokenCache();
    return { ok: false, reason: "gmail_revoked" };
  }
  if (!response.ok) return { ok: false, reason: "gmail_error" };
  return { ok: true };
}

function paymentBodies(
  email: PaymentInfoEmail,
  appUrl: string,
): { subject: string; text: string; html: string } {
  const link = receiptUrl(appUrl, email.receiptPath);
  const lines = [
    `Order ${email.orderNumber}`,
    `Qty ${email.quantity} · ${email.sectionName}`,
    `Total ₱${email.totalPesos}`,
    email.rebatePesos
      ? `Show-day rebate ₱${email.rebatePesos} — bring your card.`
      : null,
    `Pay by ${email.deadlineManila}`,
    ...email.paymentLines,
    `Upload your receipt: ${link}`,
  ].filter(Boolean) as string[];

  const text = lines.join("\n");
  const html = `<div>${lines
    .map((line) => {
      if (line.startsWith("Upload your receipt:")) {
        return `<p>Upload your receipt: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
      }
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("")}</div>`;

  return {
    subject: `Payment details for order ${email.orderNumber}`,
    text,
    html,
  };
}

function claimBodies(email: ClaimCodeEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const lines = [
    `Order ${email.orderNumber}`,
    `Claim code: ${email.claimCode}`,
    `Seats: ${email.seatLabels.join(", ")}`,
    `Section: ${email.sectionName}`,
    email.rebatePesos
      ? `Show-day rebate ₱${email.rebatePesos} — bring your card.`
      : null,
  ].filter(Boolean) as string[];
  const text = lines.join("\n");
  const html = `<div>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>`;
  return {
    subject: `Claim code for order ${email.orderNumber}`,
    text,
    html,
  };
}

export function createGmailEmailClient(
  env: EnvBag = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): EmailClient {
  const config = requireGmailEnv(env);

  return {
    async sendPaymentInfo(email) {
      const token = await refreshAccessToken(config, fetchImpl, nowMs());
      if (!token.ok) return token;
      const bodies = paymentBodies(email, config.appUrl);
      const raw = buildMimeMessage({
        from: config.from,
        to: email.to,
        subject: bodies.subject,
        text: bodies.text,
        html: bodies.html,
      });
      return sendRaw(token.token, raw, fetchImpl);
    },
    async sendClaimCode(email) {
      const token = await refreshAccessToken(config, fetchImpl, nowMs());
      if (!token.ok) return token;
      const bodies = claimBodies(email);
      const raw = buildMimeMessage({
        from: config.from,
        to: email.to,
        subject: bodies.subject,
        text: bodies.text,
        html: bodies.html,
      });
      return sendRaw(token.token, raw, fetchImpl);
    },
  };
}
