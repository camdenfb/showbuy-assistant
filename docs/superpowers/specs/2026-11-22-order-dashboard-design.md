# Slice 5: Order dashboard

**Date:** 2026-11-22  
**Status:** approved  
**Source of truth:** `spec.md` Features 1 (payment settings + switcher), 6, 7 (manual confirm only)

## Intent

Showbuyer dashboard for one showbuy at a time: payment accounts, order tracker with manual status/payment actions, private receipt upload (no AI), and Process orders with demo email outbox.

## In scope

- Showbuy switcher on `/dashboard` with links to Orders, Payments, Import, public Order page, Outbox
- Payment account CRUD (platform, name, number; optional QR in private Storage)
- Order list + status moves via `canTransition(..., "showbuyer")`
- Confirm payment → `confirmPayment` + seats `sold_direct`
- Reject receipt → `rejectReceipt`; cancel → `cancelOrder`
- `/receipt/[token]` upload PNG/JPEG/WebP ≤4MB → Storage + `receipts` + `payment_submitted`
- Process orders → `planProcessOrders` + payment/claim emails; claim codes from template
- Demo outbox viewer

## Out of scope

- Receipt AI, reconciliation, promos/analytics, seat moves, showbuy create wizard, `[PROPOSED]` overdue release

## Constraints

- Rules stay pure in `lib/rules`; server validates + persists
- AI never sets Paid
- Never log names, emails, receipt contents, or claim codes
- Fictional payment details only
