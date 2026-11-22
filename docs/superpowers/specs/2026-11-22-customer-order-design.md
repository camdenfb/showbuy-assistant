# Slice 4: Customer order page

**Date:** 2026-11-22  
**Status:** approved (slice prompt from setup.md + user go-ahead)  
**Source of truth:** `spec.md` (v2) Feature 5, AI seat assigner, AC6–8, AC12, AC14, AC30–34

## Intent

Mobile-first public order page for one showbuy: seat map, two choices, customer form, server price preview, atomic hold via `hold_seats`, demo email outbox, and the required AI seat assigner with code fallback. Fake AI covers invalid IDs, timeout, and instruction-injection notes.

## Approaches considered

1. **Public `/order/[showbuyId]` + adapters** (chosen) — server actions, service_role holds, demo email outbox, AI behind interface with fake for tests  
2. Dashboard-only offline entry — incomplete for the slice  
3. Client-side pricing / holds — rejected (spec: server owns price and holds)

## Goals

- Customer page: map (direct-buy selectable; available_t2m → Ticket2Me link only), qty + preferred section, first/second choice, form fields from spec, optional AI note (≤200, not saved)  
- Price preview from `quotePrice` only (browser total ignored)  
- Submit → hold first choice, else second; else no order + up to 3 AI/fallback suggestions; confirm suggestion → `p_suggested_choice` hold  
- Email adapter: demo mode writes to in-memory/on-screen outbox; never log PII in app logs  
- AI seat assigner: candidates from code only; discard unknown IDs/facts; 5s timeout; fallback nearest; note is data never instructions  
- Tests with fake AI: invalid IDs, timeout, note that tries to give instructions (AC31–33)

## Non-goals

- Dashboard Process orders / Paid confirmation (slice 5)  
- Receipt AI (slice 6)  
- Reconciliation cron (slice 7)  
- Promo admin UI (slice 8) — applying an existing promo code on the order form is in scope if promos exist  
- **[PROPOSED]** rules as product decisions  
- New libraries (stack already has `ai` + `@ai-sdk/anthropic`; no Resend required for demo outbox)

## Prep for Die Beautiful

- Ensure a fictional payment account exists for showbuy `cccccccc-…` (hold_seats requires it)  
- Direct-buy seats already marked (Heart R)

## Constraints

- Money in centavos; pesos in UI; Manila time  
- Validate every input on the server  
- AI never holds, prices, emails, or sets Paid  
- Never log names, emails, receipt contents, or claim codes  
- Fictional payment details only in seed/settings  
- `DEMO_MODE=true` → demo Ticket2Me + outbox; live Ticket2Me already exists when false  

## Acceptance mapping

| AC | Coverage in this slice |
|---|---|
| 6, 7, 8 | hold first/second / suggest when both fail |
| 12 | available_t2m → link, no hold |
| 14 | server price wins |
| 30 | rebate preview without promo |
| 31–34 | assigner discard / fallback / note / confirm before hold |
