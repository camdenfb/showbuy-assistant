import { afterEach, describe, expect, test, vi } from "vitest";
import { createLiveTicket2Me, createTicket2MeClient } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Ticket2Me adapter factory", () => {
  test("uses the demo fixture when DEMO_MODE is true", async () => {
    const client = createTicket2MeClient({ DEMO_MODE: "true" });
    const feed = await client.fetchSeatPlan("demo-t2m-show-15");
    expect(feed.length).toBe(3);
    expect(feed[0]?.seats.some((s) => s.seat_no === "EMPTY")).toBe(true);
    expect(feed[1]?.seats.every((s) => s.seat_no === "EMPTY")).toBe(true);
    const tickets = await client.fetchShowTickets("demo-t2m-show-15");
    expect(tickets.map((t) => t.id).sort()).toEqual([101, 102]);
    expect(tickets[0]?.title).toBeTruthy();
  });

  test("fails closed when DEMO_MODE is missing", () => {
    expect(() => createTicket2MeClient({})).toThrow("ticket2me_fail_closed");
  });

  test("uses live client when DEMO_MODE is false and base URL is set", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/get_seat_plan")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            status: "success",
            data: {
              attributes: [
                {
                  rowNumber: 1,
                  seats: [
                    { ticket_id: 1, seat_id: 10, seat_no: "A1", status: 0 },
                    { ticket_id: 0, seat_id: 0, seat_no: "EMPTY", status: -1 },
                  ],
                },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          status: "success",
          data: {
            tickets: [
              {
                id: 72367,
                title: "BRAINS - Door Orch L",
                price: "6720.00",
                color: "#ff8000",
              },
            ],
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTicket2MeClient({
      DEMO_MODE: "false",
      TICKET2ME_EVENT_SERVICE_URL:
        "https://example.test/ticket2me-event-service",
    });
    const feed = await client.fetchSeatPlan("29225");
    const tickets = await client.fetchShowTickets("29225");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/ticket2me-event-service/show/29225/get_seat_plan",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/ticket2me-event-service/show/29225/tickets",
      expect.objectContaining({ method: "GET" }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]?.seats[0]?.seat_no).toBe("A1");
    expect(tickets).toEqual([
      {
        id: 72367,
        title: "BRAINS - Door Orch L",
        pricePesos: 6720,
        color: "#ff8000",
      },
    ]);
  });

  test("refuses live mode when DEMO_MODE is false but base URL is missing", () => {
    expect(() => createTicket2MeClient({ DEMO_MODE: "false" })).toThrow(
      "ticket2me_live_misconfigured",
    );
  });
});

describe("createLiveTicket2Me", () => {
  test("rejects blank show ids before calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createLiveTicket2Me({
      TICKET2ME_EVENT_SERVICE_URL: "https://example.test/ticket2me",
    });
    await expect(client.fetchSeatPlan("  ")).rejects.toThrow(
      "ticket2me_invalid_show_id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws ticket2me_fetch_failed on non-OK HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }),
    );
    const client = createLiveTicket2Me({
      TICKET2ME_EVENT_SERVICE_URL: "https://example.test/ticket2me/",
    });
    await expect(client.fetchSeatPlan("29225")).rejects.toThrow(
      "ticket2me_fetch_failed",
    );
  });
});
