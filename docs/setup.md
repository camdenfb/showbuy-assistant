# Setup guide

How to take Showbuy Assistant from `spec.md` to a live URL with Cursor, GitHub, Supabase and Vercel.

Run every command in Cursor's terminal, inside the `showbuy-assistant` folder, one block at a time. If a block fails, stop there and fix it before running the next one.

## Rules before you start

- Open **only** `showbuy-assistant` in Cursor, never its parent folder. Only this folder becomes the public repo.
- Never commit real buyers, payment accounts, QR codes, receipts or the Ticket2Me address. Shows and seat plans can be real.
- Never paste a key into Cursor's chat. Keys go in `.env.local`, Vercel or GitHub secrets.
- The graded deployment uses only fictional buyers, receipts and payment details. A real deployment would be a separate Supabase and Vercel project.

## 1. Git identity and the spec history

In GitHub, open **Settings > Emails**, turn on **Keep my email addresses private**, and copy the `users.noreply.github.com` address. It keeps your real email out of the public commit history.

```bash
git init -b main
```

Replace both values before running these:

```bash
git config user.name "YOUR_GITHUB_USERNAME"
```

```bash
git config user.email "YOUR_NOREPLY_ADDRESS"
```

Commit version 1, then version 2, so GitHub shows the revision after review:

```bash
mv spec.md docs/spec-v2.md && cp docs/spec-v1.md spec.md
```

```bash
git add spec.md && git commit -m "docs: add spec version 1"
```

```bash
mv docs/spec-v2.md spec.md
```

```bash
git add spec.md docs && git commit -m "docs: revise spec to version 2 after review"
```

## 2. Scaffold the app

The generator refuses a folder that contains `spec.md`, so move it aside and back:

```bash
mv spec.md docs/spec.md
```

```bash
npx create-next-app@16 . --ts --tailwind --eslint --app --use-npm --import-alias "@/*" --agents-md --no-agent-feedback --disable-git --yes
```

```bash
mv docs/spec.md spec.md
```

```bash
npm install @supabase/supabase-js @supabase/ssr ai @ai-sdk/anthropic zod
```

```bash
npm install -D vitest supabase @types/node@26
```

```bash
npm pkg set scripts.test="vitest run" scripts.typecheck="next typegen && tsc --noEmit" engines.node="26.x"
```

```bash
npm run dev
```

Open http://localhost:3000, check that the starter page loads, then press Ctrl+C.

```bash
git add . && git commit -m "chore: scaffold Next.js app"
```

## 3. Project rules

Paste this into Cursor's Agent:

> Read spec.md. Keep the Next.js block already in AGENTS.md and add four sections: project overview, commands, architecture and critical constraints. Make sure CLAUDE.md imports AGENTS.md. Create .cursorrules with no more than 10 rules: strict TypeScript, Tailwind, business rules only in lib/rules, a test for every rule, money in centavos, validate on the server, no real personal or payment data, never read or print .env.local, AI can never set Paid, and ask before implementing a rule marked [PROPOSED]. Don't write any app code.

Read the three files, then:

```bash
git add AGENTS.md CLAUDE.md .cursorrules && git commit -m "docs: add AI project rules"
```

## 4. Publish to GitHub

1. Run `git status` and check that no `.env` file or private file is listed.
2. If you don't have a GitHub repo yet, open **Source Control** in Cursor, click **Publish Branch** and choose **public**.
3. If you already made one, connect it with `git remote add origin <repo URL>`, then run `git push -u origin main`. The repo must be public by the time you submit.

## 5. Supabase

1. At https://supabase.com create a project named `showbuy-assistant-demo`. Choose the closest region and save the database password in your password manager.
2. In **Authentication**, turn off **Allow new users to sign up**.
3. In **Authentication > Users**, add the showbuyer and the demo user by hand.
4. In **Settings > API Keys**, find the publishable key and the secret key. Don't use the older `anon` and `service_role` keys, which are being retired.

Create `.env.local` in the project root and fill it in yourself:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ANTHROPIC_API_KEY=
CRON_SECRET=
DEMO_MODE=true
TICKET2ME_EVENT_SERVICE_URL=
```

- `ANTHROPIC_API_KEY` comes from the Claude Console. Set a monthly spend limit there. It's needed from slice 4, both here and in Vercel.
- `CRON_SECRET` is any long random value, for example from `openssl rand -hex 32`.
- Email isn't needed in demo mode (on-screen outbox). With `DEMO_MODE=true`, Ticket2Me uses the fictional Harbor Lights seat plan. With `DEMO_MODE=false`, set `TICKET2ME_EVENT_SERVICE_URL` to Ticket2Me's event-service base URL so the server can read `/show/{id}/get_seat_plan`. Leave `DEMO_MODE` unset only if you want fail-closed (no Ticket2Me calls).

Connect the database:

```bash
npx supabase init
```

```bash
npx supabase login
```

```bash
npx supabase link
```

Docker isn't needed for these, or for pushing migrations with `npx supabase db push --remote`. It is needed to run Supabase on your own computer.

## 6. Build in slices

Give Cursor one slice at a time. Read the diff, run `npm test` and try it in the browser before committing.

**Build order: 1, 2, 3, 4, 5, 7. Then 6 and 8, if time permits.** Slice numbers are kept so prompts and commits still match.

### Required

| # | Slice | Prompt for Cursor | Commit |
|---|---|---|---|
| 1 | Rules and tests | Read spec.md. Implement seat, price, discount and order-status rules in lib/rules as pure functions. Write the Vitest tests first, citing acceptance criteria numbers. No UI or database. | `feat: add tested business rules` |
| 2 | Database | Write Supabase migrations for the spec's data types with row-level security, a transaction for holds, and seed data for two fictional showbuys. Show me the SQL before pushing it. | `feat: add schema and demo data` |
| 3 | Seat map import | Build the Ticket2Me adapter and import screen from spec.md. Create a small fictional seat plan with the same fields: rows with rowNumber and seats, each with ticket_id, seat_id, seat_no and status (0, 2, -1). An EMPTY seat_no is a gap. | `feat: import seat map` |
| 4 | Customer order | Build the mobile-first customer page: seat map, two choices, form, price preview, atomic hold, the demo outbox email, and the AI seat assigner from spec.md with its fallback. Test it with fake AI responses, including invalid IDs, a timeout and a note that tries to give instructions. | `feat: add customer ordering` |
| 5 | Dashboard | Build the login, showbuy switcher, payment settings, order tracker, private receipt upload, manual payment confirmation, manual status update and Process orders button. No AI yet. | `feat: add order dashboard` |
| 7 | Reconciliation | Build reconciliation as specified, protected by CRON_SECRET, with the demo replay. Schedule it hourly with Supabase Cron and run it on order page load. Never overwrite a hold made during a check. | `feat: reconcile inventory` |

### Optional, if time permits

| # | Slice | Prompt for Cursor | Commit |
|---|---|---|---|
| 6 | AI receipt check | Add the spec's AI module to the existing receipt upload. Test with fake AI responses, including an image that tries to give instructions. | `feat: add AI receipt check` |
| 8 | Promos and analytics | Build promo management and the analytics dashboard exactly as specified. | `feat: add promos and analytics` |

> **Brief requirement:** the AI seat assigner in slice 4 is the required AI capability, so don't cut it. Slice 6 is an optional second one.

## 7. Vercel

Do this after slice 1, so there is a test to run in the pipeline.

Create `vercel.json`, so that only GitHub Actions deploys:

```json
{
  "git": { "deploymentEnabled": false }
}
```

Create and link the project:

```bash
npx vercel@latest login
```

```bash
npx vercel@latest link
```

1. In Vercel, add each variable from `.env.local` under **Settings > Environment Variables**.
2. Create a token under **Account Settings > Tokens**.
3. In GitHub, open **Settings > Secrets and variables > Actions** and add three secrets: `VERCEL_TOKEN` (the token), plus `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (both are in `.vercel/project.json`).

## 8. GitHub Actions

Create `.github/workflows/ci.yml`:

```yaml
name: CI/CD

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://example.supabase.co
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: placeholder
          DEMO_MODE: "true"

  deploy:
    needs: check
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npx vercel@latest pull --yes --environment=production --token="$VERCEL_TOKEN"
      - run: npx vercel@latest build --prod --token="$VERCEL_TOKEN"
      - run: npx vercel@latest deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

```bash
git add vercel.json .github && git commit -m "ci: test and deploy with GitHub Actions"
```

```bash
git push
```

Watch the **Actions** tab. A green run prints the live URL in its deploy step.

## 9. Before submitting

- Turn on Vercel Analytics in the dashboard, then run `npm install @vercel/analytics` and add its component to the root layout.
- Schedule hourly reconciliation with Supabase Cron once the app has a URL.
- Test the live URL in an incognito window.
- Add the demo login instructions, a disclosure of reused work and of AI assistance to the README.
- Open one GitHub issue for version 2, for example "Support more than one showbuyer".
- Record the 2-minute demo.
- Free Supabase projects pause after a week without activity, so open the app shortly before grading.
