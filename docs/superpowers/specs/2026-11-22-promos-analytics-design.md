# Slice 8: Promos and analytics

**Date:** 2026-11-22  
**Status:** approved  
**Source of truth:** `spec.md` Feature 4 + Feature 8

## Intent

Showbuyer promo CRUD and analytics (per showbuy + combined), using pure rules for accounting. No receipt AI, no reconcile.

## Surfaces

- `/dashboard/showbuys/[id]/promos` — create/edit codes, section prices, active, usage limit, SINGLE
- `/dashboard/analytics` — metrics + finance settings (fee, capital, other expenses, deduct rebates)

## Accounting

As locked in the implementation plan: sold/to-sell counts, gross from confirmed orders + T2M seats, promo expense, fees on T2M only, rebates optional in profit, ROI with dash when capital+other is zero.
