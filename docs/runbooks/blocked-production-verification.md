# Runbook: Blocked production verification checklist (#111, #112, #290, #236)

Issues #111, #112, #290, and #236 are blocked on production credentials,
signed-in browser actions, external provider approval, or private account data.
Do not guess from local behavior and do not paste secrets, raw provider payloads,
provider ids, tokens, database URLs, or service-role keys into issues, PRs, chat,
or logs.

Use this page as the operator index before running the issue-specific runbooks:

- [#111 Operationalize the LLM reimbursement candidate detector](operationalize-llm-reimbursement-detector.md)
- [#112 Verify Google Calendar production OAuth and planning signals](verify-google-calendar-prod-oauth.md)
- [#290 Enable Plaid Liabilities due dates/minimum payments](enable-plaid-liabilities.md)
- [#236 Verify Supabase finance migrations and Plaid sync](verify-supabase-migrations-and-plaid-sync.md)

## 1. Run the no-secret preflight

From the repo root:

```bash
npm run ops:preflight
```

The helper checks local migration-file presence plus production-shaped env
presence/URL shape. It does **not** contact Supabase, Plaid, Google, OpenAI,
Vercel, or OpenClaw, and it prints only set/missing state. To make missing
required inputs fail automation in a trusted operator shell:

```bash
npm run ops:preflight -- --strict
```

## 2. Interpret blocker states

| Issue | Local/safe checks | Human-only unblock |
| --- | --- | --- |
| #111 | `npm run ops:preflight`, then `npm run reimbursement:preflight` with production server env loaded | Enable flags intentionally, trigger the cron-guarded scan once, review real proposal volume/quality |
| #112 | `npm run ops:preflight`, then `npm run calendar:prod-smoke` with production Calendar env loaded | Sign in, connect/disconnect Google Calendar, verify live signal usefulness and failure states |
| #290 | `npm run ops:preflight` with production Plaid env loaded | Confirm Plaid approved Liabilities, set `PLAID_ENABLE_LIABILITIES=true`, then use Settings → Enable due dates to re-consent existing card connections |
| #236 | `npm run ops:preflight`, then `npm run migrations:verify` with production Supabase env loaded | Apply migrations if needed, confirm RLS/policies, run a signed-in Plaid sync or safe refresh probe |

Stop at the first `BLOCKED` line until that missing production input is fixed.
A `WARN` line usually means the safe default is still in place or an optional
live smoke input is absent.

## 3. Safe closeout notes

When updating the GitHub issue, include only:

- command names run and pass/fail status,
- migration names or env variable names, never their values,
- safe statuses such as `ready`, `not_configured`, `disabled`, `succeeded`, or
  a sanitized Plaid item-repair/config code,
- proposal counts, false-positive themes, and prompt/threshold changes for
  #111 without raw transaction/provider details.
- for #290, only whether Liabilities approval was confirmed, whether
  `PLAID_ENABLE_LIABILITIES` is enabled, and aggregate counts of cards that now
  show due dates/minimum payments.

Do not include provider request ids, Plaid access tokens, OAuth tokens, service
role keys, database URLs, account masks, raw Google event descriptions,
attendee emails, or raw Plaid payloads.
