import { validateT2mWire, type T2mFeedRow, type T2mWireResponse } from "../../rules/import-map";
import { DEMO_SEAT_PLAN } from "./fixture";
import { t2mWireSchema } from "./schema";

export type Ticket2MeClient = {
  fetchSeatPlan: (showId: string) => Promise<T2mFeedRow[]>;
};

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

export function createDemoTicket2Me(): Ticket2MeClient {
  return {
    async fetchSeatPlan(showId: string) {
      void showId;
      return unwrap(DEMO_SEAT_PLAN);
    },
  };
}

export function createLiveTicket2Me(): Ticket2MeClient {
  return {
    async fetchSeatPlan() {
      throw new Error("ticket2me_live_disabled");
    },
  };
}

/** Fail closed unless DEMO_MODE is exactly "true". */
export function createTicket2MeClient(
  env: NodeJS.ProcessEnv | { DEMO_MODE?: string | undefined } = process.env,
): Ticket2MeClient {
  if (env.DEMO_MODE === "true") {
    return createDemoTicket2Me();
  }
  throw new Error("ticket2me_fail_closed");
}
