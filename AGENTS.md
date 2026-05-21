# Agent Contribution Notes

This repo handles personal finance data. Keep changes small, reviewable, and explicit about verification.

## Default Workflow

1. Inspect `package.json`, `.github/workflows`, `README.md`, `ARCHITECTURE.md`, `OPERATIONS.md`, `docs/PRODUCT_PRINCIPLES.md`, and the target code before editing.
2. Check `git status --short --branch` and avoid bundling unrelated local changes.
3. Prefer focused PRs that preserve the existing app UX unless the task explicitly asks for UX changes.
4. Update the relevant docs when routes, environment variables, setup steps, security behavior, data shape, or CI behavior change.
5. Run the narrowest useful local checks, then broaden based on risk.

## Automation Preference

Default to doing the low-risk, repeatable work automatically so the user has less to manage: inspect relevant files, make focused edits, run the narrowest useful verification, and report the result with skipped checks called out. Prefer durable setup improvements, scripts, tests, and documented repo instructions when they reduce future manual steps without broadening scope.

Still ask before risky, destructive, shared-visible, or finance-data-sensitive actions, including production changes, pushes, PR creation, schema/data migrations, credential handling, and anything that could affect user-owned financial records.

If the user explicitly tells Codex to continue despite a model-routing recommendation, state the routing check once and proceed. Do not repeatedly block on asking the user to switch models.

## Parallel And Multi-Agent Work

The user prefers Codex to lean toward parallelization when it will improve quality or speed. Treat this as standing permission to use subagents for complex, separable work.

- Use subagents for independent codebase research, broad audits, large test-fix loops, repetitive migrations, or implementation slices with disjoint file ownership.
- Before delegating, state the split briefly: what stays in the main session, what each subagent owns, and how results will be verified.
- Do not delegate the immediate critical-path task if the main session is blocked on that answer; handle blocking work locally.
- Keep delegated write scopes separate to avoid conflicts, and do not let agents revert unrelated user changes.
- For simple, single-file, or tightly coupled tasks, stay in the main session.
- Risky or shared-visible actions still require explicit confirmation: pushing, opening/closing PRs, force-pushes, destructive commands, production changes, or sending messages.

## Checks

Use these commands when practical:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm test
npm run test:e2e
npm run build
npm audit --omit=dev
git diff --check
```

`npm test` runs typecheck plus unit tests. `npm run test:e2e` starts the Next.js dev server through Playwright and uses demo mode; set `ENABLE_DEMO_MODE=true` explicitly in CI or scripted runs.

## Data And Secret Guardrails

- Never commit `.env.local`, real financial exports, provider payload dumps, access tokens, service-role keys, auth headers, or database URLs.
- Keep Plaid access tokens and Supabase service-role operations in server-only code.
- Preserve the raw-versus-enriched transaction split.
- Keep user-owned rows scoped by `user_id` and account for RLS when changing database access.
- Treat AI output as advisory. It should not perform autonomous writes.

## PR Notes

Every PR should state what changed, why it changed, the verification performed, and any skipped checks or environment blockers. For overnight agent work, include enough handoff detail that the next reviewer can continue without reconstructing local context.
