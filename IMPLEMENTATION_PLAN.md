# Personal Finance Copilot Implementation Plan

## Current Baseline

The repository now contains a Next.js App Router prototype implementation of the Claude Design `Ledger.html` handoff:

- `src/components/ledger/ledger-app.tsx`
- `src/components/ledger/data.ts`
- `src/app/globals.css`
- `src/app/page.tsx`

This is a real React/TypeScript implementation with mock data and local state. It is not yet connected to Supabase, Plaid, persistent storage, or real AI providers.

## Stack

- Next.js App Router with TypeScript.
- CSS-first implementation for the imported Ledger design.
- Lucide React icons.
- Future UI additions may use Tailwind CSS and shadcn/ui where they fit the design system.
- Supabase Postgres and Supabase Auth.
- Plaid Sandbox first.
- Deterministic/mock AI adapter first, real provider later.
- Vercel deployment target.

## Phases

### Phase 0: Foundation

- Keep the Ledger UI compiling and building.
- Add environment examples.
- Add CI for install, lint, typecheck, test, and build.
- Keep README, PRD, and implementation plan current.

Exit criteria:

- `npm run dev` starts.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- Documentation describes environment variables and next work.

### Phase 1: Data/Auth Foundation

- Add Supabase Auth.
- Add protected route handling.
- Add Supabase migrations for MVP tables.
- Seed demo data equivalent to the Ledger mock data.
- Add typed data access helpers.

Exit criteria:

- User can sign in/out.
- Protected app routes redirect unauthenticated users.
- Seeded data supports dashboard, transactions, recurring, and review queue.
- Raw/enriched transaction separation exists in schema.

### Phase 2: Plaid Sandbox Sync

- Add Plaid server client.
- Create link token route.
- Exchange public token server-side.
- Persist items and institutions.
- Sync accounts, balances, balance snapshots, and transactions.
- Prevent duplicate transactions.

Exit criteria:

- Sandbox institution connection works.
- Accounts and transactions import.
- Last sync and safe error state display.
- Re-sync is idempotent.

### Phase 3: Core Finance UI

- Replace mock data reads with data access calls.
- Keep Ledger shell/navigation and responsive behavior.
- Add persistent transaction editing.
- Add category and intent management.
- Add audit events.

Exit criteria:

- User edits persist.
- Raw Plaid fields remain unchanged.
- Dashboards use enriched/user-confirmed labels.
- Transfers are excluded from spending totals.

### Phase 4: Review Intelligence

- Add AI suggestion adapter interface.
- Implement deterministic/mock provider.
- Generate review reasons.
- Persist and resolve review items.
- Confirm/dismiss recurring candidates.
- Link insight cards to evidence.

Exit criteria:

- Ambiguous transactions enter review queue with reasons.
- User can accept, edit, dismiss, or split without leaving workflow.
- Peer-to-peer items remain unresolved until explained.
- Recurring candidates can be confirmed/dismissed.

### Phase 5: Export and Deployment

- Add CSV export endpoint.
- Add loading, empty, and error states.
- Add focused unit tests and smoke tests.
- Add Vercel/Supabase/Plaid deployment notes.

Exit criteria:

- Reviewed/enriched transactions export correctly.
- CI passes.
- Vercel build passes.
- MVP can be used end-to-end with Plaid Sandbox.

## GitHub Issue Map

1. Create PRD and implementation plan docs.
2. Scaffold Next.js app and Ledger design baseline.
3. Configure Supabase Auth and environment.
4. Add database schema and seed data.
5. Build app shell and navigation.
6. Implement Plaid Link connection.
7. Implement account, balance, and transaction sync.
8. Build accounts and net worth dashboard from persisted data.
9. Build transaction table and filters from persisted data.
10. Build transaction editing, categories, and intent labels.
11. Add AI suggestion adapter and mock suggestions.
12. Build review queue workflow.
13. Build Venmo/Zelle/Cash App shared-expense resolution.
14. Build recurring expense detection.
15. Build insight cards with evidence links.
16. Add CSV export.
17. Add tests, CI, and reviewer checklist.
18. Configure Vercel deployment and production readiness notes.

## Parallelization Guidance

Ready after the app scaffold is stable:

- Auth/environment can run in parallel with schema work if auth code owns session helpers only.
- App shell polish can run in parallel with schema work if it keeps mock data boundaries.
- After schema lands, dashboard, transaction table, AI adapter, and recurring detection can run in parallel.

Avoid parallel edits:

- Do not split schema ownership across agents.
- Do not parallelize transaction table and transaction edit drawer unless component ownership is explicit.
- Keep Plaid Link and Plaid sync with one agent until the data contract is stable.
- Do not parallelize review queue and peer-to-peer resolution unless mutation APIs are already fixed.
- Avoid multiple agents editing README/docs at the same time.

## Reviewer Checklist

- Does the change satisfy the issue acceptance criteria?
- Does it preserve raw provider data?
- Does it protect user-owned data with `user_id` boundaries?
- Does it avoid exposing Plaid tokens to the browser?
- Does it keep unresolved data distinct from trusted totals?
- Do lint, typecheck, tests, and build pass?
