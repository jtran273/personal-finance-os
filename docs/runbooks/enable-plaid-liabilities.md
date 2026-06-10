# Runbook: Enable Plaid Liabilities due dates and minimums (issue #290)

Tally already stores and renders credit-card due dates, minimum payments, APRs,
and statement timing when Plaid Liabilities data is available. The remaining
production work is approval and re-consent, not a destructive reconnect.

Do not paste Plaid secrets, access tokens, provider ids, raw provider payloads,
account masks, database URLs, or service-role keys into issues, PRs, chat, or
logs.

## 1. Confirm Plaid approval

Before setting the flag, confirm the production Plaid app is approved for the
Liabilities product. Do not enable the flag just to test approval: requesting an
unapproved optional product can break Link creation with `INVALID_PRODUCT`.

Safe closeout note:

- "Plaid Liabilities approval confirmed for production app" or "not approved
  yet"; do not include request ids or provider payloads.

## 2. Preflight production env shape

With production server env loaded in a trusted operator shell:

```bash
npm run ops:preflight
```

For #290, the preflight checks only local env shape:

- `PLAID_CLIENT_ID` present
- `PLAID_ENV` present and warns unless it is `production`
- `PLAID_PRODUCTION_SECRET` or `PLAID_SECRET` present
- `PLAID_ENABLE_LIABILITIES` state

It does not contact Plaid and never prints secret values.

## 3. Enable the optional product

After approval is confirmed, set this in production:

```bash
PLAID_ENABLE_LIABILITIES=true
```

Redeploy or restart the production runtime so Link token creation reads the new
environment.

## 4. Re-consent existing card connections

Existing Plaid Items were usually linked with Transactions only. They will not
retroactively gain Liabilities access just because the env flag changed.

Use the app's non-destructive flow:

1. Open Settings.
2. In Bank connections, choose **Enable due dates** for each eligible
   credit-card institution.
3. Complete Plaid Link update mode.
4. Run a manual sync or wait for the next scheduled sync.

Do not disconnect and re-add the institution unless you are intentionally
testing account-deduplication behavior. The update-mode flow avoids creating
duplicate account rows.

## 5. Verify display and OpenClaw behavior

After re-consent and sync:

- Dashboard card actions should show issuer due dates and minimum payments for
  supported cards.
- Cards with due dates should stop showing the "Enable due dates" reconnect
  prompt.
- OpenClaw credit nudges should only mention real due-date/minimum-payment
  reminders when connected liability data is present.

Safe closeout note:

- aggregate counts only, such as "2 card connections re-consented; 3 active
  cards now show due dates/minimums; 0 still missing."
- no account masks, Plaid account ids, raw liability payloads, or request ids.

## 6. Roll back safely

If Link creation fails with an optional-product error or Plaid approval is not
confirmed, set:

```bash
PLAID_ENABLE_LIABILITIES=false
```

Existing Transactions access remains usable. Cards that already synced liability
fields can continue to display stored values, but new/re-consented items will no
longer request Liabilities until the flag is re-enabled.
