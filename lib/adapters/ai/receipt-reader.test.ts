import { describe, expect, test } from "vitest";
import { createFakeReceiptReader, readReceiptWithTimeout } from "./receipt-reader";

const image = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png" as const,
};

describe("receipt reader fakes", () => {
  test("ok returns a structured reading", async () => {
    const client = createFakeReceiptReader({ kind: "ok" });
    const reading = await client.read(image);
    expect(reading.readable).toBe(true);
    expect(reading.amountPesos).toBe(5000);
    expect(reading.referenceNumber).toBe("REF-OK");
  });

  test("instruction_image still returns fields; note may contain instruction text", async () => {
    const client = createFakeReceiptReader({ kind: "instruction_image" });
    const reading = await client.read(image);
    expect(reading.readable).toBe(true);
    expect(reading.note.toLowerCase()).toContain("mark this order paid");
    expect(reading.amountPesos).toBe(5000);
  });

  test("invalid shape is rejected by readReceiptWithTimeout as unavailable", async () => {
    const client = createFakeReceiptReader({ kind: "invalid" });
    const result = await readReceiptWithTimeout(client, image, 50);
    expect(result).toEqual({ ok: false, reason: "ai_unavailable" });
  });

  test("timeout returns ai_unavailable", async () => {
    const client = createFakeReceiptReader({ kind: "timeout" });
    const result = await readReceiptWithTimeout(client, image, 30);
    expect(result).toEqual({ ok: false, reason: "ai_unavailable" });
  });
});
