# Customer Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mobile-first customer order page with atomic holds, demo email outbox, and AI seat assigner + fallback.

**Architecture:** Public `/order/[showbuyId]` talks only to server actions. Pure rules build candidates and sanitize AI picks. Adapters (email outbox, seat-assigner AI) sit behind interfaces with fakes for Vitest. `hold_seats` remains the only write path for holds.

**Tech Stack:** Next.js 16 App Router, Zod, Supabase service client, Vitest, Vercel AI SDK (`ai` + `@ai-sdk/anthropic` already installed)

**Spec:** `docs/superpowers/specs/2026-11-22-customer-order-design.md` + `spec.md` Feature 5 / AI seat assigner / AC6–8,12,14,30–34

## Global Constraints

- Money in centavos; UI shows pesos; Manila time
- Validate every input on the server; ignore browser totals
- AI never holds, prices, emails, or sets Paid; discard unknown IDs/facts
- Never log names, emails, receipts, or claim codes
- No new libraries without asking; no **[PROPOSED]** as product decisions
- No commit/push/db push until asked

## Review Focus

- Both choices free → first held only
- First taken → second held
- Both taken → no order; ≤3 suggestions; confirm then hold
- Fake AI returns unknown id / bad fact → discarded
- Fake AI timeout / empty note → nearest fallback
- Instruction-injection note → still only allowed seats at server prices
- available_t2m click → Ticket2Me link path, no hold
- Missing payment account → clear error

## File structure

- `lib/rules/seat-assigner.ts` (+ `.test.ts`) — build candidates, sanitize picks, fallback, reason lines
- `lib/adapters/email/` — `EmailClient`, demo outbox store, factory
- `lib/adapters/ai/seat-assigner.ts` (+ tests) — live Claude + fake injectable
- `app/order/[showbuyId]/` — page, form client, actions (preview price, submit, confirm suggestion)
- Seed/upsert fictional payment account for Die Beautiful (script or one-off via service client in prep; not committed secrets)

---

### Task 1: Seat-assigner pure rules (TDD)

**Files:** `lib/rules/seat-assigner.ts`, `lib/rules/seat-assigner.test.ts`

- [ ] Failing tests: build ≤30 candidates (direct_buy, no conflict, preferred section, contiguous qty, SINGLE if needed); sanitize picks (drop unknown ids, repeats, false facts); fallback nearest; uncheckable flag when note asks for unmapped amenity keywords only after AI says so — code still never shows model text
- [ ] Implement until green
- [ ] Types match spec `SeatCandidate` / `SeatPicks` / `SeatFact`

### Task 2: Email demo outbox + AI adapter fakes

**Files:** `lib/adapters/email/*`, `lib/adapters/ai/seat-assigner.ts`, tests

- [ ] `EmailClient.sendPaymentInfo(...)` → demo pushes to module-level outbox (no Resend)
- [ ] Outbox readable for dashboard later; order page can show “check demo outbox” in demo
- [ ] `SeatAssignerClient.suggest({ note, candidates })` with fake implementations: ok / invalid ids / timeout / instruction note
- [ ] Live path uses Haiku via AI SDK only when key present; 5s AbortSignal; Zod-validate `SeatPicks`

### Task 3: Order server actions

**Files:** `app/order/[showbuyId]/actions.ts`

- [ ] `previewQuote` — validate seats/section/promo/card; return `quotePrice` result
- [ ] `submitOrder` — validate; try hold first then second via RPC; on both fail run assigner+fallback and return suggestions (no order)
- [ ] `confirmSuggestion` — re-quote + `hold_seats` with suggested arrays only
- [ ] On successful hold: send payment email via adapter; if email fails set Process Order Manually if that status exists — else record audit/manual reason without inventing Paid
- [ ] Idempotency key from client; payment_account_id required

### Task 4: Mobile customer UI

**Files:** `app/order/[showbuyId]/page.tsx`, `order-form.tsx`, small map component

- [ ] Load showbuy, for-sale sections, seats, payment accounts, event URL
- [ ] Map: direct_buy selectable; available_t2m shows link CTA; others non-selectable
- [ ] Two choices, form fields, price preview, optional note
- [ ] Suggestion confirm step with prices
- [ ] White bg / black text consistent with dashboard

### Task 5: Die Beautiful payment account + verify

- [ ] Upsert fictional GCash payment account for Die Beautiful (impossible account number)
- [ ] `npm test`, lint, typecheck
- [ ] Manual: open `/order/cccccccc-cccc-cccc-cccc-cccccccccccc`, hold Heart R direct-buy seat
- [ ] Stop for review (no commit until asked)
