# Pay timing + AI receipt check

**Date:** 2026-11-22  
**Status:** approved (simplified) — hold on submit after Pay later / Pay now choice (no soft-cart token). Soft-cart 15‑minute pending checkout was deferred.  
**Source of truth:** `spec.md` Feature 5 / Feature 6 / Feature 7.

## Intent

Some customers can pay the moment seats are available; others need the payment email later. Don’t hold seats until they choose. After a receipt is uploaded, optional AI reads the image so the showbuyer can confirm faster — especially whether the **total amount** matches — without ever letting AI set Paid.

## Goals

- After a successful form submit (choices still free), ask **Pay now** or **Pay later** before any hold.
- **Pay later:** hold seats, send payment-info email (template 1) with private `/receipt/[token]` link; no on-page QRs required.
- **Pay now:** hold seats, **do not** email; show all payment QRs (chosen account first) and the upload link.
- Pending choice expires in **15 minutes** with **nothing to release** (no hold yet).
- Slice 6: on upload, AI extracts `ReceiptReading`; code builds `ReceiptCheck` warnings (amount in centavos vs order total, recipient, date, duplicate reference, unreadable, ai_unavailable). Order stays Payment Submitted. Instruction text in the image changes nothing.
- Fake AI in tests covers match, mismatch, instruction injection (“mark this order paid”), timeout/invalid → `ai_unavailable`.

## Non-goals

- Payment processing / auto-Paid
- Changing claim-code flow
- Reconnect Gmail UI (separate)
- `[PROPOSED]` 48-hour overdue one-click release
- Embedding the upload form on the order success screen (link to `/receipt/[token]` only)

## Anti-goals

- Holding seats while the customer hesitates on Pay now / Pay later
- Emailing on Pay now
- Giving the model the expected amount or recipient
- AI changing status, seats, price, or sending email

## Constraints

- `spec.md` + stack already in repo; ask before new libraries
- Money in centavos; validate on server; never log names, emails, receipt contents, claim codes
- Fictional buyers/receipts/payment details only
- AI seat assigner pattern: adapter + fake; Haiku via Vercel AI SDK; Zod-validate output
- Receipt AI timeout 15s; seat assigner remains 5s
- Existing `hold_seats` RPC remains the only hold write path

## Approaches

1. **Hold, then choose** — hold on submit, then Pay now/later; 15‑minute cancel if no choice. Rejected: user does not want abandoned holds.
2. **Split pay-timing and AI into two ships** — same end state, slower. Rejected for this pass: user asked to proceed with slice 6 and the order-page change together.
3. **Soft cart, hold only after choice (chosen)** — submit validates and returns a 15‑minute signed pending checkout; Pay now/later triggers `hold_seats`. Abandon = expire pending checkout only.

## Design

### Pending checkout (no order row)

- Submit action validates input, quotes price, and checks that first or second choice (or a later confirmed suggestion) **could** be held, but **does not** call `hold_seats` yet.
- If neither choice is free → today’s suggestion flow (AI/fallback); confirming a suggestion returns to the same Pay now / Pay later step with that seat set in the pending checkout.
- Server returns a **signed pending checkout** (HMAC or sealed payload) including showbuy id, seat ids, customer fields already validated, payment account id, totals, promo/card flags, and `expiresAt` = now + 15 minutes. No seats locked; no `orders` row.
- **Builder call:** prefer a signed opaque token over a new DB table so abandon leaves no cleanup. Token rejected after expiry or if payload tampered.

### Pay now / Pay later

- Client shows two actions that post the pending token + choice.
- Server: reject if expired/invalid; then `hold_seats` in one transaction as today.
- Hold failure (race): no order; return suggestions or map again — same as current unavailable path.
- Hold success → order at `sent_payment_info`, 48‑hour hold starts here.
  - **`later`:** send payment-info email; set `payment_email_sent_at` on success; on failure → `process_manually` / `payment_email_failed` as today. Success UI: “details emailed” (+ outbox note in demo).
  - **`now`:** do **not** send email; leave `payment_email_sent_at` null; success UI shows payment lines + QR images for all showbuy payment accounts (**chosen account first**) and link to `/receipt/[token]`.
- Persist choice for Process orders: **`payment_timing`** on `orders` as `'now' | 'later'` (set only after successful hold). **Builder call:** `text` check constraint; required on new orders after this ships.
- **Process orders:** send payment email only for `payment_timing = 'later'` and `payment_email_sent_at` null (retry). Never email `now` orders for payment info. Claim-code sending unchanged.

### QR display (pay now)

- Signed URLs (or equivalent private read) for each account’s `qr_code_path` from Storage, short TTL.
- Missing QR: show platform + account name/number text only for that account.

### AI receipt check (slice 6)

- After successful storage + `receipts` insert + status → `payment_submitted`, server calls receipt AI with **image only**.
- Validate with Zod against `ReceiptReading` from `spec.md`.
- Pure rule `buildReceiptCheck(...)` → `ReceiptCheck`. **Builder calls for matching (unless product overrides):**
  - **amount_mismatch:** `Math.round(amountPesos * 100) !== order.totalCentavos` (null amount → `unreadable` or amount warning only if `readable === false`).
  - **date_mismatch:** if `paidAt` present, it must fall on a calendar day from order creation through hold deadline (Asia/Manila); future dates mismatch; missing date → no date warning alone.
  - **duplicate_reference:** same showbuy, any other order’s stored reference; exclude current order.
  - **recipient_mismatch:** last-4 of account number must match when both present; name is a soft check (normalized contains); platform vs `method` is advisory only (no hard fail if method is `other`/null).
- Store result in `receipts.check_payload`. **Builder call:** keep JSON payload shape stable for the dashboard.
- `applyReceiptCheck` remains a no-op on status (AC16/AC18): warnings only.
- Dashboard order/receipt view: show image, reading fields, warnings; confirm/reject unchanged and still showbuyer-only for Paid.
- Adapter: `createReceiptReader` / fake behaviors (`ok`, `instruction_image`, `timeout`, `invalid`) mirroring seat-assigner tests. Live path: Claude Haiku 5.5, 15s abort, only when key present.
- Existing orders without `payment_timing`: treat as `'later'` for Process orders.

### Spec edits (same change set)

- Feature 5: payment email is **not** immediate on every hold; hold happens after Pay now/Pay later; email only on later; abandon before choice holds nothing.
- Process orders bullet: payment email only for later + unsent.
- Feature 7 / AI: amount compared in centavos by code; instruction-in-image test called out.

## Left to the builder

- Exact signed-token helper location and secret (`CRON_SECRET` reuse vs dedicated env — prefer dedicated `CHECKOUT_SIGNING_SECRET` or derive from existing server secret only if setup docs stay one-line; **ask before adding env name if not in setup.md** — use existing pattern: document in setup if new).
- Whether suggestion confirm posts into pending checkout or reuses current confirm-then-hold (must end at choice step without hold).
- Dashboard UI polish for warnings (table vs receipt detail).
- Wiring `dispatchOrderEmail` dedupe (nice-to-have; not required to ship this design).
