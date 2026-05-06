# Personal Finance Copilot PRD

## Product Summary

Personal Finance Copilot is a single-user finance dashboard that connects to Plaid Sandbox, imports financial data into Supabase, preserves raw provider records, and lets the user review and enrich transactions before trusting dashboard totals.

The MVP should feel like a calm finance operating system: dense enough for real review work, but quiet and readable. The initial UI direction is the Claude Design `Ledger.html` handoff: warm neutral surfaces, editorial serif headings, compact tables, review nudges, peer-to-peer resolution, and mobile bottom navigation.

## MVP Goals

- Sign in and sign out with Supabase Auth.
- Connect Plaid Sandbox institutions.
- Sync accounts, balances, and transactions.
- Store immutable raw transaction payloads separately from editable user enrichment.
- Show account overview grouped by cash, credit, investments, and retirement.
- Show net worth, cash, liabilities, investments, retirement, balance snapshots, and spending summaries.
- Provide transaction search, filtering, sorting, and editing.
- Support editable merchant, category, subcategory, intent, notes, and review status.
- Generate review items for ambiguous, low-confidence, large, peer-to-peer, unclear transfer, missing category, and recurring-candidate transactions.
- Support Venmo, Zelle, and Cash App explanation plus split workflows.
- Detect recurring expense candidates and allow confirm or dismiss.
- Show deterministic/mock insight cards before real AI integration.
- Export reviewed/enriched transactions to CSV.

## Non-Goals

- Production Plaid launch.
- Receipt OCR.
- Tax-specific export formats beyond simple CSV.
- Native mobile app.
- Multi-user household support.
- Autonomous AI edits.
- Real OpenClaw write actions.

## Key Workflows

### First Run

1. User signs in.
2. User lands on the Ledger dashboard with seeded demo data if Plaid is not connected.
3. User connects a Plaid Sandbox institution from settings.
4. App syncs accounts, balances, and transactions.

### Daily Review

1. User opens Today.
2. Dashboard shows net worth, spending period controls, review count, insights, and recent activity.
3. User opens the review queue.
4. User accepts, edits, dismisses, or explains each flagged transaction.
5. Resolved items leave the queue and trusted totals update.

### Peer-to-Peer Resolution

1. Peer-to-peer transaction is flagged.
2. User explains the transaction in plain language.
3. The app proposes structured splits.
4. User edits split category, intent, and amounts.
5. Transaction becomes resolved only after the split is fully allocated.

### Export

1. User filters reviewed/enriched transactions.
2. User exports CSV.
3. CSV includes raw identifiers and user-approved labels, but no Plaid access tokens.

## Data Principles

- Raw Plaid data is immutable from the app perspective.
- User enrichment is the source of truth for dashboards and exports.
- Every user-owned record includes `user_id`.
- Sync jobs must be idempotent.
- Plaid access tokens are server-only secrets.
- Audit events record material label and review changes.

## UX Direction

- Name: Ledger.
- Primary layout: desktop sidebar, mobile bottom tab bar.
- First screen: Today dashboard, not a marketing page.
- Style: quiet finance dashboard with editorial headings, tabular numbers, restrained color, and dense but readable tables.
- Core views: Today, Transactions, Review, Recurring, Accounts, Settings.
- AI behavior: suggestions are visible as suggestions only; unresolved data should not be presented as confirmed.

## Acceptance Criteria

- A signed-in user can move through the whole seeded MVP without Plaid.
- A Plaid Sandbox user can connect, sync, and re-sync without duplicates.
- Raw and enriched transaction data are stored separately.
- Dashboard spending totals exclude transfers and unresolved peer-to-peer splits where appropriate.
- Review queue explains why each transaction needs attention.
- CSV export matches selected filters and excludes secrets.
