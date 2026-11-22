<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project overview

Showbuy Assistant helps one Philippine showbuyer run several Ticket2Me showbuys at once. A showbuy is one performance (one show, date, and time). The app reconciles the showbuyer's records with Ticket2Me, sells pulled-out seats directly, tracks each order from hold to claim code, and reports profit. It only reads Ticket2Me and never pulls seats out itself. `spec.md` is the source of truth.

## Commands

- `npm run dev` — start the Next.js dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — ESLint
- `npm run test` — Vitest
- `npm run typecheck` — `next typegen` then `tsc --noEmit`

Requires Node `26.x`.

## Architecture

The customer order page and the showbuyer dashboard contain no business rules. Both talk to the Next.js server on Vercel, which owns:

- Pure rules for seats, promos, orders, and analytics in `lib/rules` (no network or database calls)
- Adapters for AI (Claude Haiku 5.5 via the Vercel AI SDK), email (Resend, or an on-screen outbox in the demo), and Ticket2Me (live read, or demo replay)
- Supabase Postgres, Auth, private Storage, and Cron

An hourly cron hits `/api/reconcile`. Holds run in one database transaction. Pull requests run lint, type check, tests, secret scan, and build; `main` deploys to Vercel only when all pass.

## Critical constraints

- Use only the stack in `spec.md`. Ask before adding a library or service, and before implementing a rule marked `[PROPOSED]`.
- Store money in centavos. Show pesos and Manila time.
- Validate every input on the server. Check the login on every dashboard action and the cron secret on every scheduled call.
- Turn on row-level security for every table. Receipt links use long random tokens and work for one order.
- Keep secrets in environment variables. Never read, print, or commit `.env` files. Payment details live in showbuy settings, not in Git.
- Never log names, emails, receipt contents, or claim codes.
- Use only fictional shows, buyers, receipts, seat plans, and payment details.
- AI has two jobs: rank seat options that code supplies (seat assigner, required) and read receipts (optional). Discard anything it returns that code didn't supply. The seat assigner never receives names, contact details, or prices. It cannot hold or assign a seat, change a status, seat, or price, send email, or set an order to Paid. Only the showbuyer's confirmation can set Paid.
