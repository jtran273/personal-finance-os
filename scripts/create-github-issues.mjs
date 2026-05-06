#!/usr/bin/env node

const repo = process.env.GITHUB_REPOSITORY || "jtran273/personal-finance-os";

const issues = [
  ["01 - Create PRD and implementation plan docs", "Docs are present locally in PRD.md, IMPLEMENTATION_PLAN.md, and README.md. Close after the baseline PR lands."],
  ["02 - Scaffold Next.js app and Ledger design baseline", "Scaffold the Next.js App Router app and implement the Claude Design Ledger.html baseline. Close after the current baseline PR lands."],
  ["03 - Configure Supabase Auth and environment", "Add Supabase browser/server helpers, login/logout, protected middleware, and env docs. Do not change schema."],
  ["04 - Add database schema and seed data", "Create Supabase migrations and seed data for the MVP tables with raw/enriched transaction separation and user ownership."],
  ["05 - Build app shell and navigation", "Harden the authenticated shell, navigation, loading, empty, and error states using the Ledger design direction."],
  ["06 - Implement Plaid Link connection", "Add Plaid client, link token route, public token exchange, and connected institution persistence."],
  ["07 - Implement account, balance, and transaction sync", "Sync Plaid accounts, balances, snapshots, and transactions with duplicate prevention and safe errors."],
  ["08 - Build accounts and net worth dashboard from persisted data", "Replace mock dashboard/account data with persisted data and verified finance calculations."],
  ["09 - Build transaction table and filters from persisted data", "Wire transaction table search/filter/sort to persisted data and support larger datasets."],
  ["10 - Build transaction editing, categories, and intent labels", "Persist editable enrichment fields, custom categories, intent labels, and audit events."],
  ["11 - Add AI suggestion adapter and mock suggestions", "Define provider interface and deterministic/mock suggestion provider with tests."],
  ["12 - Build review queue workflow", "Persist review item generation and resolution for low-confidence, large, peer-to-peer, transfer, missing category, and recurring candidates."],
  ["13 - Build Venmo/Zelle/Cash App shared-expense resolution", "Persist explanations and splits, and update spending calculations from split data."],
  ["14 - Build recurring expense detection", "Detect weekly/monthly/annual candidates, confirm/dismiss, and flag meaningful changes."],
  ["15 - Build insight cards with evidence links", "Generate deterministic insights linked to supporting transactions or filtered views."],
  ["16 - Add CSV export", "Export enriched/reviewed transactions with filters and no sensitive tokens."],
  ["17 - Add tests, CI, and reviewer checklist", "Add CI, focused unit tests, smoke tests, audit check, and PR checklist."],
  ["18 - Configure Vercel deployment and production readiness notes", "Document Supabase, Vercel, Plaid Sandbox env vars, safe logging, and MVP limitations."]
];

for (const [title, body] of issues) {
  console.log(`gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}`);
}
