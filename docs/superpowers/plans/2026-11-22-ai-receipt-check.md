# AI receipt check (slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or implement inline with TDD). Steps use checkbox (`- [ ]`) syntax.

**Goal:** On receipt upload, AI reads the image into `ReceiptReading`; code builds `ReceiptCheck` warnings (amount in centavos, recipient, date, duplicate ref); store in `receipts.check_payload`; show on dashboard. AI never sets Paid. Status stays Payment Submitted.

**Architecture:** Pure `buildReceiptCheck` in `lib/rules`. Adapter `createReceiptReader` with fakes (ok / instruction_image / timeout / invalid) and live Haiku 15s path. Upload action runs check after insert and updates `check_payload`.

**Tech Stack:** Zod, Vitest, Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), existing receipt upload + orders dashboard.

**Spec:** `spec.md` Feature 7 + AI receipt check; AC16–18.

**Out of scope:** Pay now/later, Receipt Accepted/Rejected statuses, Gmail dedupe.

---

## File map

| File | Role |
|------|------|
| `lib/rules/receipt-check.ts` | Types + `buildReceiptCheck` |
| `lib/rules/receipt-check.test.ts` | AC16–18 style tests |
| `lib/adapters/ai/receipt-reader.ts` | Fake + live reader |
| `lib/adapters/ai/receipt-reader.test.ts` | Fake behaviors |
| `app/receipt/[token]/actions.ts` | Call reader + store payload |
| `app/dashboard/showbuys/[id]/orders/*` | Show reading + warnings |

---

### Task 1: `buildReceiptCheck` rule (TDD)

- [x] Failing tests: amount match/mismatch; null amount + unreadable; instruction note ignored for status (via existing `applyReceiptCheck`); duplicate reference; recipient last-4; date window Manila; ai_unavailable when reading null
- [x] Implement `buildReceiptCheck`
- [x] Tests pass

### Task 2: Receipt reader adapter (TDD)

- [x] Failing tests: ok reading; instruction_image returns structured fields without status change responsibility; timeout/invalid → treat as unavailable at call site
- [x] Implement fake + live Haiku (`claude-haiku-5-5`, image only, 15s)
- [x] Tests pass

### Task 3: Wire upload + dashboard

- [x] After receipt insert, load order total + payment account + prior refs; run reader; `buildReceiptCheck`; update `check_payload`
- [x] Orders UI: show warnings + key reading fields next to receipt link
- [x] `npm run test` for touched files; typecheck if needed

**Ruling:** No Receipt Accepted/Rejected statuses in this slice — stay on Payment Submitted after upload; showbuyer still Confirms paid. No API key → `ai_unavailable` warning (manual review).
