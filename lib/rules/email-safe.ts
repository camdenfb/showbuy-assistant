export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const from = sanitizeHeaderValue(input.from);
  const to = sanitizeHeaderValue(input.to);
  const subject = sanitizeHeaderValue(input.subject);
  const boundary = `sb_${crypto.randomUUID().replaceAll("-", "")}`;

  const textPart = [
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
  ].join("\r\n");

  const htmlPart = [
    "Content-Type: text/html; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
  ].join("\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart,
    `--${boundary}`,
    htmlPart,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
