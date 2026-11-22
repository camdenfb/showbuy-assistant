# Reconciliation (slice 7) Implementation Plan

> **For agentic workers:** Implement with TDD. Checkboxes track progress.

**Goal:** Reconcile Ticket2Me seat status into local seats; cron + order-page load; respect per-showbuy `sync_interval_minutes`; never wipe a hold mid-check; pause orders on failed/empty/malformed feed.

**Out of scope:** `[PROPOSED]` reconcile-on-submit, auto-unpause, pull-out confirm UX.

## Tasks

### Task 1: Pure helpers
- [x] `shouldReconcileShowbuy({ lastSyncedAt, syncIntervalMinutes, startsAt, now })`
- [x] `t2mWireStatusToReading` + build `SyncReading` from feed cells keyed by our seat ids via `t2m_seat_id`
- [x] Tests

### Task 2: `runShowbuyReconcile`
- [x] Fetch plan via Ticket2Me adapter (demo/live)
- [x] Apply `reconcileShowbuy`; on write, if seat is `on_hold` in DB, never change `status` / `active_order_id` (only `t2m_status` + `conflict`)
- [x] Update `last_synced_at`, `orders_paused`, `sync_runs`, `audit_log`

### Task 3: API + triggers
- [x] `GET/POST /api/reconcile` requires `CRON_SECRET`
- [x] Order page load calls reconcile for that showbuy (share in-flight promise)
- [x] Optional Vercel cron hourly in `vercel.json`

### Task 4: Settings
- [x] Expose `syncIntervalMinutes` on create/edit showbuy form (default 60, min 1)

**Ruling:** Under `DEMO_MODE=true`, skip (don’t pause) showbuys whose `t2m_show_id` is not a demo fixture id.
