# Slice 9: Showbuy setup

**Date:** 2026-11-22  
**Status:** approved  
**Source of truth:** `spec.md` Feature 1 (+ finance moved off analytics)

## Intent

Create and edit showbuys from the dashboard. Move fee / capital / expenses / rebate deduct into showbuy settings. Analytics becomes read-only for those values.

## Surfaces

- Dashboard: **New showbuy**, **Edit settings** per row
- `/dashboard/showbuys/new` → create → redirect to import, then payments
- `/dashboard/showbuys/[id]/settings` → edit
- Analytics: show finance values + **Edit in settings** link; delete finance form + `saveShowbuyFinance`

## Fields

name, event URL (https), show ID, starts_at (Manila enter/show, timestamptz store), backend access, coverage full|partial, fee %, capital (pesos UI → centavos), other expenses list, claim code template, deduct card rebates (default off).

Create: fee, capital, expenses required (0 allowed); no hidden defaults for those.

## URL → show ID

Pattern (optional `www.`):

`https://ticket2me.net/event/{eventId}/show/{showId}`

Prefill show ID from `{showId}`; always editable.

## Locked after import

If any seats exist for the showbuy, `event_url` and `t2m_show_id` are read-only; UI points to import for re-import.

## Coverage

- full → all sections for sale (import/settings show mode)
- partial → per-section for-sale switches on import

## Claim code

Default template: `{section}{order}-{seat}-{qty}{discount}{random}`  
Allowed placeholders only; must include `{order}` and `{random}`.  
`{random}` = exactly 3 digits. Section codes HE/TL; discount PW/SR/NO; order padded ≥2 digits. Uniqueness via existing unique index + regenerate on conflict.

## Email templates

Out of this slice (Feature 1 email editor deferred).

## Migration

None expected — `showbuys` already has all columns.
