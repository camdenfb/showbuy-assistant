# Showbuy Assistant

Showbuy Assistant helps a Philippine theater showbuyer run several Ticket2Me showbuys at once. A showbuy is one performance (one show, date and time), or a block of its seats, bought to resell.

Showbuyers usually track seat requests by hand while keeping two inventories in agreement: their own records and Ticket2Me. That is slow and leads to wrong quotes and seats sold twice. This app reconciles the two, sells pulled-out seats directly to customers, tracks each order from hold to claim code, and reports profit.

**Live app:** _add the Vercel URL here_

## What it does

- **Manage showbuys:** set up several performances, each with its Ticket2Me event URL, show ID, fee percentage, capital, expenses, payment accounts and claim code format.
- **Import the seat map:** pull the seat plan from Ticket2Me, with section names and prices prefilled, then mark each off-sale seat as house, direct buy, hold or sold direct.
- **Reconcile with Ticket2Me:** an hourly check compares the app's seats with Ticket2Me. If Ticket2Me can't be read, orders pause for that showbuy only and resume after the next good check.
- **Take orders:** customers pick two seat choices on a map, enter an optional promo code and choose Pay later or Pay now. Holds are atomic, so two customers can never get the same seat.
- **Manage orders and confirm payment:** the showbuyer tracks each order's status, reviews uploaded receipts and confirms payment. Only the showbuyer can mark an order Paid.
- **Promos and analytics:** discount codes with per-section prices and usage limits, plus gross sales, promo expense, Ticket2Me fees, profit and ROI per showbuy and combined.

Emails go to an on-screen outbox in the dashboard. v1 sends no real email.

## AI features

Both use Claude Haiku 5.5 through the Vercel AI SDK, called only from the server. The AI never holds a seat, sets a price, changes a status or marks an order Paid.

- **Seat assigner (required):** when both of a customer's choices are taken, code builds a list of allowed seats and the AI ranks up to three against the customer's note (for example "aisle, near the front"). Code discards anything the AI returns that it didn't supply. The AI never sees names, contact details or prices. If it fails or takes more than 5 seconds, code suggests the nearest seats instead. The customer must confirm a suggestion before anything is held.
- **Receipt check:** after a receipt upload, the AI reads the screenshot. Code then compares the amount, recipient, date and reference number with the order and shows warnings to the showbuyer. Text in the image is treated as data, never as instructions.

## Tech stack

- Next.js 16 (App Router), TypeScript in strict mode, Tailwind CSS, Zod
- Supabase: Postgres with row-level security, Auth, private Storage
- Claude Haiku 5.5 via the Vercel AI SDK
- Vitest, ESLint, Gitleaks, GitHub Actions
- Hosted on Vercel

## How it's organized

```text
app/            pages and server actions
  order/        public customer order page
  receipt/      private receipt upload page (one random link per order)
  dashboard/    showbuyer dashboard (sign-in required)
  api/reconcile scheduled reconciliation endpoint (needs the cron secret)
lib/rules/      pure business rules: seats, prices, orders, claim codes, analytics
lib/adapters/   Ticket2Me, AI and email, each with a fake version for tests and the demo
lib/reconcile/  reconciliation runner
supabase/       database migrations, seed data and database tests
```

Business rules live in `lib/rules` as pure functions with no network or database calls, so each one is unit tested. Seat holds run in a single database transaction.

## Run it locally

You need Node 26, a Supabase project and, for the AI features, a Claude API key. [docs/setup.md](docs/setup.md) has the step-by-step guide.

```bash
npm install
# create .env.local with the variables below
npm run dev
```

Environment variables (set them in `.env.local` and in Vercel, never in Git):

| Name | What it's for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project |
| `SUPABASE_SECRET_KEY` | Server-only Supabase key |
| `SHOWBUYER_EMAILS` | Comma-separated emails allowed to sign in to the dashboard |
| `ANTHROPIC_API_KEY` | Claude, for the seat assigner and receipt check |
| `CRON_SECRET` | Protects `/api/reconcile` |
| `DEMO_MODE` | `true` uses the fictional demo seat plan instead of live Ticket2Me |
| `TICKET2ME_EVENT_SERVICE_URL` | Ticket2Me seat plan address, when `DEMO_MODE=false` |
| `APP_URL` | Base address for receipt links |

With `DEMO_MODE=true`, the app uses the fictional "Harbor Lights" showbuys from `supabase/seed.sql`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type check |
| `npm test` | Unit tests (Vitest) |

## CI/CD

Every pull request and push to `main` runs GitHub Actions: secret scan (Gitleaks), lint, type check, tests and a production build. The app is deployed on Vercel.

## Security and privacy

- Secrets stay in environment variables, and Gitleaks scans every push.
- Every table has row-level security. Receipts and payment QR codes are in private storage that only the server can read.
- Every input is validated on the server, and every price is calculated there. A price sent by the browser is ignored.
- Logs never contain names, emails, receipt contents or claim codes.
- The repository and demo use only fictional buyers, receipts and payment details.
- No real payments are processed. Customers pay by their own transfer and upload a receipt.

## Documentation

- [spec.md](spec.md): the product spec and source of truth, with acceptance criteria
- [AGENTS.md](AGENTS.md): rules for AI coding assistants (also read through `CLAUDE.md`)
- [docs/setup.md](docs/setup.md): setup and build guide
- [docs/spec-v1.md](docs/spec-v1.md): the first version of the spec, kept for the review record

## Not in v1

Pull-out request tasks, a seat status summary, moving an order to another seat, editable email templates, real email sending and a separate demo login are planned for v2. Payment processing and writing to Ticket2Me are out of scope.
