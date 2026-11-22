# Showbuy setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feature 1 create/edit showbuys + move finance off analytics.  
**Architecture:** Pure Zod/rules in `lib/rules/showbuy.ts` (+ claim-code updates); server actions with `requireShowbuyer`; forms under `/dashboard/showbuys`.  
**Tech:** Next.js App Router, Zod, Vitest, Manila time for `starts_at`.  
**No migration** unless a column is missing. **No commit / push / db push.**

## File map

| File | Role |
|---|---|
| `lib/rules/showbuy.ts` | URL parse, Zod parse, locked-field check, finance expenses parse |
| `lib/rules/showbuy.test.ts` | Tests first |
| `lib/rules/claim-code.ts` | Require `{random}`, 3-digit random, placeholders, HE/TL + PW/SR/NO helpers |
| `app/dashboard/showbuys/new/page.tsx` | Create form |
| `app/dashboard/showbuys/[id]/settings/page.tsx` | Edit form |
| `app/dashboard/showbuys/actions.ts` | create/update actions |
| `app/dashboard/showbuys/showbuy-form.tsx` | Shared form (finance fields included) |
| `app/dashboard/page.tsx` | New + Edit settings links |
| `app/dashboard/analytics/*` | Read-only finance; delete form + save action |
| Import page | Show coverage mode |

## Tasks

### Task 1: Rules + claim-code (TDD)

- [ ] Failing tests: URL extract, finance parse, showbuy input Zod, locked event/show id, claim template `{order}`+`{random}`, 3-digit random, unknown placeholder reject
- [ ] Implement until green

### Task 2: Create/edit UI + actions

- [ ] Shared form + create/update with `requireShowbuyer`
- [ ] Lock URL/show id when seats exist; redirect create → import
- [ ] Dashboard links; coverage note on import

### Task 3: Analytics finance move

- [ ] Delete `finance-form.tsx` and `saveShowbuyFinance`
- [ ] Read-only values + Edit in settings link

### Task 4: Verify

- [ ] `npm test`, `lint`, `typecheck`, `build`
- [ ] Show diff + SQL (none expected)
