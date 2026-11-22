import { createTicket2MeClient } from "@/lib/adapters/ticket2me";
import { mapDbSeat } from "@/lib/order/map-seat";
import { reconcileShowbuy } from "@/lib/rules/seats";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildSyncReadingFromFeed, shouldReconcileShowbuy } from "./policy";

export type ReconcileResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; ordersPaused: boolean; seatsUpdated: number }
  | { ok: false; reason: string; ordersPaused: true };

const inflight = new Map<string, Promise<ReconcileResult>>();

export function reconcileShowbuyShared(
  showbuyId: string,
  options: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const key = `${showbuyId}:${options.force ? "force" : "interval"}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const pending = runShowbuyReconcile(showbuyId, options).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

export async function runShowbuyReconcile(
  showbuyId: string,
  options: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const supabase = createSupabaseServiceClient();
  const nowMs = Date.now();

  const { data: showbuy } = await supabase
    .from("showbuys")
    .select(
      "id, t2m_show_id, starts_at, last_synced_at, sync_interval_minutes, orders_paused",
    )
    .eq("id", showbuyId)
    .maybeSingle();
  if (!showbuy) return { ok: false, reason: "showbuy_not_found", ordersPaused: true };

  if (
    !shouldReconcileShowbuy({
      startsAt: showbuy.starts_at,
      lastSyncedAt: showbuy.last_synced_at,
      syncIntervalMinutes: showbuy.sync_interval_minutes,
      nowMs,
      force: options.force,
    })
  ) {
    return { ok: true, skipped: true, reason: "not_due" };
  }

  const { data: syncRun, error: syncInsertError } = await supabase
    .from("sync_runs")
    .insert({ showbuy_id: showbuyId, detail: { trigger: options.force ? "page" : "cron" } })
    .select("id")
    .single();
  if (syncInsertError || !syncRun) {
    return { ok: false, reason: "sync_run_failed", ordersPaused: true };
  }

  const started = Date.now();
  try {
    const { data: seatRows } = await supabase
      .from("seats")
      .select(
        "id, showbuy_id, section_id, row_label, seat_number, grid_row, position, status, t2m_status, conflict, t2m_seat_id",
      )
      .eq("showbuy_id", showbuyId);

    const seats = (seatRows ?? []).map((row) => mapDbSeat(row));
    if (seats.length === 0) {
      await finishSync(supabase, syncRun.id, showbuyId, true, {
        seatsUpdated: 0,
        note: "no_seats",
      }, started);
      await supabase
        .from("showbuys")
        .update({ last_synced_at: new Date().toISOString(), orders_paused: false })
        .eq("id", showbuyId);
      return { ok: true, skipped: false, ordersPaused: false, seatsUpdated: 0 };
    }

    // Demo adapter only knows Harbor Lights fixtures — don't pause a live show id under DEMO_MODE.
    if (
      process.env.DEMO_MODE === "true" &&
      !String(showbuy.t2m_show_id).startsWith("demo")
    ) {
      await finishSync(
        supabase,
        syncRun.id,
        showbuyId,
        true,
        { seatsUpdated: 0, note: "demo_mode_skipped_live_show" },
        started,
      );
      return { ok: true, skipped: true, reason: "demo_mode_skipped_live_show" };
    }

    let feed;
    try {
      feed = await createTicket2MeClient().fetchSeatPlan(showbuy.t2m_show_id);
    } catch {
      await pauseAndFail(supabase, showbuyId, syncRun.id, "ticket2me_fetch_failed", started);
      return { ok: false, reason: "ticket2me_fetch_failed", ordersPaused: true };
    }

    const reading = buildSyncReadingFromFeed({
      seats: (seatRows ?? []).map((row) => ({
        id: row.id,
        t2mSeatId: row.t2m_seat_id,
      })),
      feed,
    });

    const result = reconcileShowbuy(seats, reading);
    if (!reading.ok || result.ordersPaused) {
      await pauseAndFail(
        supabase,
        showbuyId,
        syncRun.id,
        reading.ok ? "reconcile_paused" : "malformed_or_incomplete_feed",
        started,
      );
      return {
        ok: false,
        reason: reading.ok ? "reconcile_paused" : "malformed_or_incomplete_feed",
        ordersPaused: true,
      };
    }

    const { data: holdRows } = await supabase
      .from("seats")
      .select("id, status")
      .eq("showbuy_id", showbuyId)
      .eq("status", "on_hold");
    const holdIds = new Set((holdRows ?? []).map((row) => row.id));

    let seatsUpdated = 0;
    for (const seat of result.seats) {
      const patch = holdIds.has(seat.id)
        ? {
            t2m_status: seat.t2mStatus,
            conflict: seat.conflict,
          }
        : {
            status: seat.status,
            t2m_status: seat.t2mStatus,
            conflict: seat.conflict,
          };
      const { error } = await supabase.from("seats").update(patch).eq("id", seat.id);
      if (!error) seatsUpdated += 1;
    }

    await supabase
      .from("showbuys")
      .update({
        last_synced_at: new Date().toISOString(),
        orders_paused: false,
      })
      .eq("id", showbuyId);

    await finishSync(
      supabase,
      syncRun.id,
      showbuyId,
      true,
      { seatsUpdated, ordersPaused: false },
      started,
    );

    return { ok: true, skipped: false, ordersPaused: false, seatsUpdated };
  } catch {
    await pauseAndFail(supabase, showbuyId, syncRun.id, "reconcile_exception", started);
    return { ok: false, reason: "reconcile_exception", ordersPaused: true };
  }
}

export async function reconcileDueShowbuys(): Promise<{
  ran: number;
  skipped: number;
  failed: number;
}> {
  const supabase = createSupabaseServiceClient();
  const nowMs = Date.now();
  const { data: showbuys } = await supabase
    .from("showbuys")
    .select("id, starts_at, last_synced_at, sync_interval_minutes")
    .gt("starts_at", new Date(nowMs).toISOString());

  let ran = 0;
  let skipped = 0;
  let failed = 0;

  for (const showbuy of showbuys ?? []) {
    if (
      !shouldReconcileShowbuy({
        startsAt: showbuy.starts_at,
        lastSyncedAt: showbuy.last_synced_at,
        syncIntervalMinutes: showbuy.sync_interval_minutes,
        nowMs,
      })
    ) {
      skipped += 1;
      continue;
    }
    const result = await reconcileShowbuyShared(showbuy.id);
    if (!result.ok) failed += 1;
    else if (result.skipped) skipped += 1;
    else ran += 1;
  }

  return { ran, skipped, failed };
}

async function pauseAndFail(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  showbuyId: string,
  syncRunId: string,
  reason: string,
  startedMs: number,
): Promise<void> {
  await supabase
    .from("showbuys")
    .update({ orders_paused: true })
    .eq("id", showbuyId);
  await finishSync(supabase, syncRunId, showbuyId, false, { reason }, startedMs);
  await supabase.from("audit_log").insert({
    event_type: "reconcile_failed",
    showbuy_id: showbuyId,
    result: "fail",
    latency_ms: Date.now() - startedMs,
    detail: { reason },
  });
}

async function finishSync(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  syncRunId: string,
  showbuyId: string,
  ok: boolean,
  detail: Record<string, unknown>,
  startedMs: number,
): Promise<void> {
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      ok,
      detail,
    })
    .eq("id", syncRunId);
  await supabase.from("audit_log").insert({
    event_type: "reconcile",
    showbuy_id: showbuyId,
    result: ok ? "ok" : "fail",
    latency_ms: Date.now() - startedMs,
    detail,
  });
}
