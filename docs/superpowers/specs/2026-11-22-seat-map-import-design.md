# Slice 3: Seat map import (+ pre-slice fixes)

**Date:** 2026-11-22  
**Status:** approved (with amendments)  
**Approach:** Option 1 (demo adapter + import wizard), with corrections below  
**Source of truth:** `spec.md` (v2)

## Intent

Let the showbuyer import a Ticket2Me-shaped seat map for a showbuy: demo fixture only in graded mode, Zod-validated feed, section mapping and prices, classify unavailable seats, save in one locked transaction. Also ship two small prep fixes (claim-code safety + suggested choice on holds) as a **separate reviewable commit** before the import work.

## Approaches considered

1. **Demo adapter + import wizard** (chosen) — fictional feed, live client stubbed off under `DEMO_MODE`
2. Live Ticket2Me HTTP now — rejected for graded demo / fictional-data rule
3. Adapter only, no screen — incomplete for the slice

## Phase 0 — separate commit (review before slice 3 code)

1. **`claimCodeAllowed`**  
   Return `true` only if every `heldSeatIds` entry is **found** in the provided seats **and** that seat has `conflict === null`. Missing seat ⇒ refuse.  
   **TDD:** failing test first, then fix.

2. **Suggested choice on holds** (Feature 5)  
   - New column `orders.suggested_choice_seat_ids uuid[]` (nullable; null = none)  
   - New migration (init already pushed): **`DROP FUNCTION`** the old `hold_seats` signature, then create the new one; `REVOKE` execute from `PUBLIC`, `anon`, `authenticated`; `GRANT` only to `service_role`; `search_path = ''`  
   - New params: `p_suggested_choice uuid[]`, `p_suggested_quote jsonb`  
   - Under showbuy `FOR UPDATE`:  
     - **If a suggested choice is present** (non-empty): hold **only** those seats with the suggested quote. If any can’t be held → write nothing, return an error (app suggests again). **Never** fall back to first or second.  
     - **If no suggestion:** normal first-then-second.  
   - Persist `suggested_choice_seat_ids` on the order when a suggestion was held  
   - Test: exactly **one** `hold_seats` exists; `anon` cannot execute it  

Commit message (when you ask): e.g. `fix: tighten claim codes and add suggested holds`  
**Do not commit, push, or `db push` until asked.**

---

## Phase 1 — Seat map import (slice 3)

### Goals

- Ticket2Me adapter interface + **demo** implementation with a small fictional plan  
- Zod validation; reject whole import (no writes) on bad data  
- Import screen (showbuyer-only): map ticket types → sections/prices, mark unavailable seats, review, save  
- Pure mapping rules tested first (AC12, AC26)  
- Save via `service_role`-only SQL function, one transaction, showbuy row locked  
- Fictional data only; live client never runs when `DEMO_MODE` is true **or missing** (fail closed)

### Non-goals

- Real Ticket2Me HTTP  
- Signup UI  
- Customer order page, AI assigner, reconciliation, promos UI (later slices)  
- Implementing **[PROPOSED]** rules as product decisions

### Wire / fixture shape

Real response shape (fixture matches exactly; adapter unwraps):

```ts
{
  success: boolean;
  status: string;
  data: {
    attributes: {
      rowNumber: number;
      seats: {
        ticket_id: number;
        seat_id: number;
        seat_no: string; // "C12" or literal "EMPTY"
        status: 0 | 2 | -1;
      }[];
    }[];
  };
}
```

- Reject `success === false`  
- Reject rows of **unequal width**, duplicate `rowNumber`, or duplicate seat **label** (non-EMPTY)  
- **`position` = array index** in the row (not the seat number)  
- **`seat_no === "EMPTY"`:** gap — `seat_id` 0, `status` -1; drop from inventory after assigning position; fixture has several EMPTY cells sharing `seat_id` 0, a whole empty row, and an aisle  
- Blank `seat_no` → malformed  
- Ticket types collected from **non-EMPTY** seats only  
- Status after drop EMPTY: `0` → `available_t2m`, `2` → `sold_t2m`, `-1` → unavailable (house until marked)  
- Label `/^[A-Z]+\d+$/` → row + number  

### Zod + adapter

- Schema validates the wire envelope + attributes  
- `demoTicket2me` returns the fixture  
- `liveTicket2me` stub; factory: if `DEMO_MODE` is **not** the string `"true"`, **fail closed** (never call live)  
- When `DEMO_MODE=true`, only demo runs  

### Partial showbuys / holds

- `sections.is_for_sale boolean not null default true`  
- Import whole map; every ticket type → exactly one section; only for-sale sections held/sold/counted  
- **`hold_seats` enforces `is_for_sale` in SQL** (with a test)  

### Auth

- `getUser()`, confirmed email, case-insensitive allowlist (`SHOWBUYER_EMAILS`)  
- Empty or missing allowlist ⇒ deny everyone  
- Secret key only in a server-only module  
- Session refresh via Next.js 16 `proxy.ts` (read `node_modules/next/dist/docs/` before implementing)  
- No signup screen  

### Import UI / save

- Browser sends only mappings + classifications  
- Server refetches feed; never trusts seats/statuses from the browser  
- Classification accepted only if that seat is **still unavailable** in the refetched feed; otherwise write nothing and return client to review  
- Review: mark unavailable seats `house` | `direct_buy` | `sold_direct` (default house); bulk OK  
- Save locks showbuy; refuse if any orders; re-import needs confirm  
- Re-import: **keep existing section IDs**, update in place (promos key by section id); refuse removing a section a promo prices  
- Sold prices: `t2m_sale_price_centavos` for `sold_t2m`; new `imported_sale_price_centavos` for `sold_direct` with no order  

### Schema (new migrations only)

- Phase 0: `suggested_choice_seat_ids`; replace `hold_seats`  
- Phase 1: `sections.is_for_sale`; `seats.imported_sale_price_centavos`; `import_seat_map`; hold_seats `is_for_sale` check  

### Tests (failing first)

| Area | Coverage |
|---|---|
| Phase 0 | Missing held seat ⇒ refuse; suggested-only hold (no first/second fallback); one `hold_seats`; anon denied |
| AC12 / AC26 | On-sale vs unavailable import; EMPTY gaps |
| Zod / feed | success=false, unequal width, dup row/label, empty, unknown status |
| Hold SQL | `is_for_sale` enforced |
| Save | Stale classification; section id preserve; promo section refuse delete |
| Auth | Empty allowlist denies; unconfirmed email denies |

### Constraints

- Money in centavos; fictional data only  
- Don’t edit `spec.md`  
- Don’t commit, push, or `db push` until asked  

## Delivery order

1. Phase 0 (tests → code → **stop for review**)  
2. Plan + Phase 1 implementation after you green-light  
