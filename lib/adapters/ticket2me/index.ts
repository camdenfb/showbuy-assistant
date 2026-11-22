import { validateT2mWire, type T2mFeedRow, type T2mWireResponse } from "../../rules/import-map";
import { DEMO_SEAT_PLAN, DEMO_SHOW_TICKETS } from "./fixture";
import { t2mTicketsSchema, t2mWireSchema } from "./schema";

export type T2mShowTicket = {
  id: number;
  title: string;
  /** Face value from Ticket2Me, in pesos (not centavos). */
  pricePesos: number;
  color: string;
};

export type Ticket2MeClient = {
  fetchSeatPlan: (showId: string) => Promise<T2mFeedRow[]>;
  fetchShowTickets: (showId: string) => Promise<T2mShowTicket[]>;
};

/** String env bag (process.env or a test stub). */
type EnvBag = Record<string, string | undefined>;

function unwrap(raw: unknown): T2mFeedRow[] {
  const parsedZod = t2mWireSchema.safeParse(raw);
  if (!parsedZod.success) {
    throw new Error("ticket2me_invalid_shape");
  }
  const validated = validateT2mWire(parsedZod.data as T2mWireResponse);
  if (!validated.ok) {
    throw new Error(validated.reason);
  }
  return validated.feed;
}

function unwrapTickets(raw: unknown): T2mShowTicket[] {
  const parsed = t2mTicketsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("ticket2me_invalid_tickets_shape");
  }
  return parsed.data.data.tickets.map((ticket) => {
    const pricePesos = Number(ticket.price);
    if (!Number.isFinite(pricePesos) || pricePesos < 0) {
      throw new Error("ticket2me_invalid_ticket_price");
    }
    return {
      id: ticket.id,
      title: ticket.title.trim() || `Ticket ${ticket.id}`,
      pricePesos,
      color: ticket.color.trim() || "#71717a",
    };
  });
}

function eventServiceBaseUrl(env: EnvBag): string {
  const raw = env.TICKET2ME_EVENT_SERVICE_URL?.trim();
  if (!raw) {
    throw new Error("ticket2me_live_misconfigured");
  }
  return raw.replace(/\/+$/, "");
}

async function getJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error("ticket2me_fetch_failed");
  }
  if (!response.ok) {
    throw new Error("ticket2me_fetch_failed");
  }
  return response.json();
}

export function createDemoTicket2Me(): Ticket2MeClient {
  return {
    async fetchSeatPlan(showId: string) {
      void showId;
      return unwrap(DEMO_SEAT_PLAN);
    },
    async fetchShowTickets(showId: string) {
      void showId;
      return DEMO_SHOW_TICKETS.map((ticket) => ({ ...ticket }));
    },
  };
}

/** Read-only live client. Base URL comes from env; never baked into git. */
export function createLiveTicket2Me(
  env: EnvBag = process.env,
  fetchImpl: typeof fetch = fetch,
): Ticket2MeClient {
  const base = eventServiceBaseUrl(env);
  return {
    async fetchSeatPlan(showId: string) {
      const id = showId.trim();
      if (!id) {
        throw new Error("ticket2me_invalid_show_id");
      }
      const raw = await getJson(
        `${base}/show/${encodeURIComponent(id)}/get_seat_plan`,
        fetchImpl,
      );
      return unwrap(raw);
    },
    async fetchShowTickets(showId: string) {
      const id = showId.trim();
      if (!id) {
        throw new Error("ticket2me_invalid_show_id");
      }
      const raw = await getJson(
        `${base}/show/${encodeURIComponent(id)}/tickets`,
        fetchImpl,
      );
      return unwrapTickets(raw);
    },
  };
}

/**
 * DEMO_MODE=true → fictional Harbor Lights fixture.
 * DEMO_MODE=false → live read via TICKET2ME_EVENT_SERVICE_URL.
 * Anything else → fail closed (no network).
 */
export function createTicket2MeClient(env: EnvBag = process.env): Ticket2MeClient {
  if (env.DEMO_MODE === "true") {
    return createDemoTicket2Me();
  }
  if (env.DEMO_MODE === "false") {
    return createLiveTicket2Me(env);
  }
  throw new Error("ticket2me_fail_closed");
}
