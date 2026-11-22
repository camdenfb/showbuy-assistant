import { describe, expect, test } from "vitest";
import {
  buildMimeMessage,
  escapeHtml,
  sanitizeHeaderValue,
  toBase64Url,
} from "./email-safe";

describe("email-safe", () => {
  test("strips line breaks from header values", () => {
    expect(sanitizeHeaderValue("Ada\r\nBcc: evil@x.test")).toBe("Ada Bcc: evil@x.test");
    expect(sanitizeHeaderValue("Ada\nLovelace")).toBe("Ada Lovelace");
  });

  test("escapes HTML in customer values", () => {
    expect(escapeHtml(`Ada <script>alert(1)</script> & "x"`)).toBe(
      "Ada &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;",
    );
  });

  test("builds UTF-8 plain+HTML MIME and base64url encodes", () => {
    const raw = buildMimeMessage({
      from: "Showbuy Assistant <showbuyer@example.test>",
      to: "buyer@example.test",
      subject: "Payment details",
      text: "Hello Ada\nTotal ₱100",
      html: "<p>Hello Ada</p><p>Total ₱100</p>",
    });
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw).toContain("charset=\"UTF-8\"");
    expect(raw).toContain("Hello Ada");
    expect(raw).not.toMatch(/\r?\nBcc:/i);

    const encoded = toBase64Url(raw);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(
      encoded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("Subject: Payment details");
  });

  test("name or email with line breaks or HTML cannot inject headers", () => {
    const raw = buildMimeMessage({
      from: "Showbuy <from@example.test>",
      to: "victim@example.test\nbcc:attacker@evil.test",
      subject: "Hi\nBcc: attacker@evil.test",
      text: 'Name: <img src=x onerror=alert(1)>',
      html: `<p>${escapeHtml('Name: <img src=x onerror=alert(1)>')}</p>`,
    });
    const headerLines = (raw.split(/\r?\n\r?\n/)[0] ?? "")
      .toLowerCase()
      .split(/\r?\n/);
    expect(headerLines.filter((line) => line.startsWith("bcc:"))).toEqual([]);
    expect(headerLines.filter((line) => line.startsWith("to:"))).toHaveLength(1);
    expect(raw).toContain("&lt;img");
  });
});

