# Personal Finance OS

A personal finance operating system for budgeting, tracking spending, and turning financial activity into clear decisions.

## Status

This repository now has the initial Ledger frontend baseline from the Claude Design handoff implemented as a Next.js App Router app.

Current docs:

- [PRD.md](PRD.md)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
- [PARALLEL_AGENTS.md](PARALLEL_AGENTS.md)
- [.env.example](.env.example)

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Current Frontend

The current UI is a mock-data Ledger prototype with:

- Today dashboard with net worth, period picker, spending bars, review nudge, insights, and recent activity.
- Transactions table with search/filter controls and editable transaction modal.
- Review queue with raw-to-suggested comparison and resolution actions.
- Peer-to-peer explanation and split modal for Venmo/Zelle/Cash App-style payments.
- Recurring expense view.
- Accounts grouped by cash, credit cards, investments, and retirement.
- Responsive mobile bottom navigation.

## Development Notes

As this project is built, changes should be small, explained clearly, and committed with meaningful messages so the implementation can double as a full-stack learning path.
