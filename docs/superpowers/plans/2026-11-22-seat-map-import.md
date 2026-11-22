# Seat Map Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Ticket2Me demo adapter and showbuyer seat-map import flow per the approved design.

**Architecture:** Zod-validated wire feed → pure map rules → demo adapter (fail closed unless `DEMO_MODE=true`) → allowlisted dashboard import UI → `import_seat_map` SQL under showbuy lock. Browser sends only mappings/classifications; server always refetches.

**Tech Stack:** Next.js 16 App Router, Zod, Supabase Auth/SSR, Postgres migrations, Vitest, Tailwind

**Spec:** `docs/superpowers/specs/2026-11-22-seat-map-import-design.md` (+ `spec.md` Feature 1 / AC12 / AC26)

## Global Constraints

- Fictional data only; never read/print `.env`
- Money in centavos; server validates all inputs
- `DEMO_MODE` missing ⇒ fail closed (no live calls)
- New migrations only (init already pushed)
- No commit / push / db push until asked
- No new libraries without asking

## Review Focus

- Stale classification after feed change → no write, back to review
- Promo-priced section removed on re-import → refuse
- `is_for_sale=false` seat held via SQL → refuse
- Empty `SHOWBUYER_EMAILS` → deny all
- Unequal row widths / duplicate labels → reject feed

---

### Task 1: Feed parse + map rules (TDD)

**Files:**
- Create: `lib/rules/import-map.ts`, `lib/rules/import-map.test.ts`
- May extend: `lib/rules/seats.ts` (`seatFromImport`)

**Interfaces:**
- Produces: `parseT2mWire(unknown) → Result`, `mapFeedToSeats(...)`, `ticketTypesFromFeed`, label parse, EMPTY drop with position = index

- [ ] Failing tests: AC12, AC26, EMPTY gaps, reject success=false / unequal width / dup rowNumber / dup label / blank seat_no / unknown status / empty feed
- [ ] Implement until green

### Task 2: Adapter + fixture

**Files:**
- Create: `lib/adapters/ticket2me/*` (types, zod, fixture, demo, live stub, factory)

- [ ] Fixture uses exact wire shape with EMPTY aisle, whole empty row, shared seat_id 0
- [ ] Factory: only demo when `DEMO_MODE==="true"`; else throw fail-closed

### Task 3: Migrations

**Files:**
- Create: `supabase/migrations/<ts>_import_seat_map.sql`
- Modify: DB tests

- [ ] `sections.is_for_sale`, `seats.imported_sale_price_centavos`
- [ ] Update `hold_seats` (drop+recreate) to require preferred section `is_for_sale`
- [ ] `import_seat_map(...)` service_role only: lock showbuy, refuse if orders, confirm replace, keep section IDs, refuse promo section removal, apply classifications only for still-unavailable seats
- [ ] pgTAP: is_for_sale hold refused; anon denied on import fn

### Task 4: Auth + import UI

**Files:**
- Create: `lib/supabase/server.ts` (secret key server-only), `lib/auth/allowlist.ts`, `proxy.ts`, login + dashboard import routes/actions/components

- [ ] `getUser()`, confirmed email, case-insensitive allowlist; empty allowlist denies
- [ ] Session refresh via Next 16 `proxy.ts` (per `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`)
- [ ] Import wizard: map ticket types, review/classify, save action refetches feed

### Task 5: Verify

- [ ] `npm test`, `npm run lint`, `npm run typecheck`
- [ ] Stop for human review (no commit/push/db push)
