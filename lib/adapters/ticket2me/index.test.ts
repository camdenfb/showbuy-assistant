import { describe, expect, test } from "vitest";
import { createTicket2MeClient } from "./index";

describe("Ticket2Me adapter factory", () => {
  test("uses the demo fixture when DEMO_MODE is true", async () => {
    const client = createTicket2MeClient({ DEMO_MODE: "true" });
    const feed = await client.fetchSeatPlan("demo-t2m-show-15");
    expect(feed.length).toBe(3);
    expect(feed[0]?.seats.some((s) => s.seat_no === "EMPTY")).toBe(true);
    expect(feed[1]?.seats.every((s) => s.seat_no === "EMPTY")).toBe(true);
  });

  test("fails closed when DEMO_MODE is missing or not true", () => {
    expect(() => createTicket2MeClient({})).toThrow("ticket2me_fail_closed");
    expect(() => createTicket2MeClient({ DEMO_MODE: "false" })).toThrow(
      "ticket2me_fail_closed",
    );
  });
});
