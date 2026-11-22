# Slice 2: Database design

**Date:** 2026-11-22  
**Status:** approved (with amendments)  
**Source of truth:** `spec.md` (v2)

## Intent

Give the demo app a Postgres schema that matches the spec’s data types, locks down access to the Next.js server only, holds seats atomically under a per-showbuy lock, and seeds two fictional showbuys. SQL is reviewed before any push. This database holds only fictional demo data.

## Goals

- Tables for showbuys, payment accounts, sections, seats, promos, orders, receipts, email outbox, sync runs, and an audit log
- Money in centavos; `timestamptz` for times
- RLS on every table; **no policies** for `anon` or `authenticated`; table privileges revoked from those roles and `PUBLIC`
- All access through the Next.js server (service role), which checks login against a showbuyer allowlist
- `hold_seats` locks the showbuy row first, then rechecks pause, scope, status, conflict, qty, promo, and SINGLE before writing
- Server-calculated quotes for each choice; save the quote for the seats actually held, per ticket
- Second choice if any first-choice seat can’t be held; if neither works, write nothing and return an error
- Idempotency key on orders; email outbox unique on `(order_id, email_type)`
- Demo data only in `supabase/seed.sql` with clearly fake account numbers (e.g. `0000-000-0000`)
- Database tests: anon/authenticated denied; two holds on one seat; two orders taking the last promo use

## Non-goals

- UI, Ticket2Me import, order page, dashboard, AI, or reconciliation jobs
- Implementing **[PROPOSED]** rules as product decisions
- Real buyer, seat-plan, or payment data
- `supabase config push` (local `config.toml` only for `enable_signup = false`)

## Anti-goals

- Any table or function access for `anon` / `authenticated`
- Partial holds or holds that skip the showbuy lock
- Committing secrets or real payment / Ticket2Me production data

## Constraints (data integrity)

- Foreign keys cannot cross showbuys (composite FKs on `(id, showbuy_id)` where needed)
- A seat has at most one active order (`seats.active_order_id`)
- Seat identity unique per showbuy: `UNIQUE (showbuy_id, t2m_seat_id)`
- Claim codes unique when present
- Money columns `>= 0`; Ticket2Me fee percent `0`–`100`
- Payment-confirmed orders cannot be cancelled (`payment_confirmed_at IS NULL OR status <> 'cancelled'`)

## Approaches considered

1. **Server-owned + `hold_seats` + seed** (chosen, amended) — server-only roles; showbuy-row lock; quotes in; outbox + idempotency
2. Schema + seed only, hold in app later — weaker concurrency
3. Anon-readable catalog — rejected; user requires no anon/authenticated table access

## Orders columns ↔ `Order` type (`spec.md`)

| Column | Spec field | Notes |
|---|---|---|
| `id` | `id` | |
| `showbuy_id` | `showbuyId` | |
| `created_at` | `createdAt` | |
| `name` | `name` | |
| `email` | `email` | |
| `mobile` | `mobile` | |
| `preferred_section_id` | `preferredSectionId` | |
| `qty` | `qty` | |
| `first_choice_seat_ids` | `firstChoice` | `uuid[]` |
| `second_choice_seat_ids` | `secondChoice` | `uuid[]` |
| `promo_code` | `promoCode` | nullable |
| `discount_card` | `discountCard` | |
| `payment_account_id` | `paymentAccountId` | |
| `status` | `status` | |
| `held_seat_ids` | `heldSeatIds` | |
| `tickets` | `tickets` | `jsonb` array of `{regularPriceCentavos, pricePerSeatCentavos}` |
| `total_centavos` | `totalCentavos` | |
| `applied_discount` | `appliedDiscount` | `none` \| `promo` \| `rebate` |
| `card_rebate_centavos` | `cardRebateCentavos` | show-day rebate; 0 when promo; default 0 |
| `payment_email_sent_at` | `paymentEmailSentAt` | |
| `hold_expires_at` | `holdExpiresAt` | |
| — | `holdRemainingMs` | **Derived** in app from `hold_expires_at` + pause rules; not stored |
| — | `receipts` | **`receipts` table**, not a column |
| `payment_confirmed_at` | `paymentConfirmedAt` | |
| `claim_code` | `claimCode` | |
| `claim_email_sent_at` | `claimEmailSentAt` | |
| `manual_reason` | `manualReason` | |
| `idempotency_key` | — | Unique per showbuy; retry safety |
| `receipt_token` | — | Long random token for private receipt link |
| `promo_id` | — | FK to applied promo when `applied_discount = promo` |

### Card rebate (spec Features 4, 5, 8)

- Customer pays full ticket prices; `card_rebate_centavos` is 20% of regular prices, paid on show day, never deducted from `total_centavos`
- Valid promo always wins: promo prices, `applied_discount = promo`, `card_rebate_centavos = 0` (no savings comparison)
- `showbuys.deduct_card_rebates` controls whether analytics subtract rebates from profit
- Enforced: promo ⇒ rebate 0; `total_centavos` equals sum of ticket `pricePerSeatCentavos`

## Hold transaction

1. `SELECT … FROM showbuys WHERE id = … FOR UPDATE`
2. Recheck `orders_paused`, section belongs to showbuy, payment account belongs to showbuy, `qty` matches choice lengths
3. Try first choice: lock seats, verify each is `direct_buy`, no conflict, same showbuy/section scope, SINGLE if required; else try second choice the same way
4. Recheck promo active + usage limit (non-cancelled orders with that promo)
5. Apply the server quote for the choice that won; set seats `on_hold` + `active_order_id`; insert order; audit row
6. On idempotent replay, return the existing order; write nothing new

Functions: `REVOKE` execute from `PUBLIC`, `anon`, `authenticated`; `GRANT` only to `service_role`; `SET search_path = ''`.

## RLS and privileges

- `ENABLE ROW LEVEL SECURITY` on every table; **zero** policies for `anon` / `authenticated`
- `REVOKE ALL` on tables, sequences, and routines from `PUBLIC`, `anon`, `authenticated`
- `GRANT` table/sequence usage and execute on `hold_seats` only to `service_role`

## Seed

`supabase/seed.sql` only: two fictional showbuys, tiny maps, fake payment accounts (`0000-000-0000` style), one limited promo for race tests.

## Auth config

`enable_signup = false` under `[auth]` in `supabase/config.toml`. Do **not** run config push.

## Tests

1. `anon` and `authenticated` cannot select/insert tables or execute `hold_seats`
2. Two holds on the same free seat → exactly one succeeds
3. Promo `usage_limit = 1` → exactly one of two competing orders gets it
