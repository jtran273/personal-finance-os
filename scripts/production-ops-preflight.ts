#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// No-secret operator preflight for the production-blocked verification issues.
//
// This script does not contact Supabase, Plaid, Google, OpenAI, Vercel, or
// OpenClaw. It only inspects local files and environment shape, and it prints
// whether sensitive variables are present rather than printing values.

type Status = "blocked" | "ok" | "warn";

interface Check {
  detail: string;
  issue: string;
  label: string;
  next: string;
  status: Status;
}

const MIGRATION_FILES = [
  "supabase/migrations/20260604000100_add_anomaly_alerts.sql",
  "supabase/migrations/20260604000200_add_plaid_pending_replacement_count.sql",
  "supabase/migrations/20260604000300_add_review_resolution_kind.sql"
];

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function envFlag(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function fileExists(path: string) {
  return existsSync(resolve(process.cwd(), path));
}

function issueHeader(issue: string) {
  switch (issue) {
    case "#111":
      return "#111 LLM reimbursement candidate detector";
    case "#112":
      return "#112 Google Calendar production OAuth";
    case "#290":
      return "#290 Plaid Liabilities due dates/minimums";
    case "#236":
      return "#236 Supabase migrations and Plaid sync";
    default:
      return issue;
  }
}

function statusPrefix(status: Status) {
  if (status === "ok") return "OK      ";
  if (status === "warn") return "WARN    ";
  return "BLOCKED ";
}

function checkRedirectUri(): Check {
  const name = "GOOGLE_CALENDAR_REDIRECT_URI";
  const value = process.env[name]?.trim();

  if (!value) {
    return {
      detail: `${name} is not set.`,
      issue: "#112",
      label: "Calendar redirect URI",
      next: "Set it to the exact production HTTPS /api/calendar/callback URI registered in Google Cloud.",
      status: "blocked"
    };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/api/calendar/callback") {
      return {
        detail: `${name} is set but does not match the required production shape.`,
        issue: "#112",
        label: "Calendar redirect URI",
        next: "Use https://<prod-host>/api/calendar/callback and mirror it in Google Cloud.",
        status: "blocked"
      };
    }
  } catch {
    return {
      detail: `${name} is set but is not a valid URL.`,
      issue: "#112",
      label: "Calendar redirect URI",
      next: "Use a valid https:// URL ending in /api/calendar/callback.",
      status: "blocked"
    };
  }

  return {
    detail: `${name} has the required production URL shape.`,
    issue: "#112",
    label: "Calendar redirect URI",
    next: "Run npm run calendar:prod-smoke with production env loaded, then verify signed-in connect/disconnect.",
    status: "ok"
  };
}

function envPresenceCheck(issue: string, label: string, vars: readonly string[], next: string): Check {
  const missing = vars.filter((name) => !configured(name));
  if (missing.length > 0) {
    return {
      detail: `Missing ${missing.join(", ")}.`,
      issue,
      label,
      next,
      status: "blocked"
    };
  }

  return {
    detail: `${vars.length} required env var(s) are set. Values were not printed.`,
    issue,
    label,
    next,
    status: "ok"
  };
}

function reimbursementChecks(): Check[] {
  const scanUserSet = configured("PROACTIVE_SCAN_USER_ID") || configured("OPENCLAW_USER_ID");
  const requiredMissing = [
    configured("OPENAI_API_KEY") ? null : "OPENAI_API_KEY",
    scanUserSet ? null : "PROACTIVE_SCAN_USER_ID or OPENCLAW_USER_ID",
    configured("SUPABASE_SERVICE_ROLE_KEY") ? null : "SUPABASE_SERVICE_ROLE_KEY",
    configured("CRON_SECRET") ? null : "CRON_SECRET"
  ].filter((value): value is string => Boolean(value));

  const checks: Check[] = [
    {
      detail: requiredMissing.length > 0
        ? `Missing ${requiredMissing.join(", ")}.`
        : "OpenAI, scan user, service role, and cron guard are present. Values were not printed.",
      issue: "#111",
      label: "Detector required env",
      next: requiredMissing.length > 0
        ? "Load production server env, then run npm run reimbursement:preflight for runtime-resolver output."
        : "Run npm run reimbursement:preflight, then start with a small PROACTIVE_SCAN_MAX_TX.",
      status: requiredMissing.length > 0 ? "blocked" : "ok"
    }
  ];

  const autoReviewEnabled = envFlag("ENABLE_OPENAI_AUTO_REVIEW");
  const proactiveScanEnabled = envFlag("PROACTIVE_SCAN_ENABLED");

  checks.push({
    detail: `ENABLE_OPENAI_AUTO_REVIEW=${autoReviewEnabled ? "true" : "not true"}, PROACTIVE_SCAN_ENABLED=${proactiveScanEnabled ? "true" : "not true"}.`,
    issue: "#111",
    label: "Detector activation flags",
    next: autoReviewEnabled && proactiveScanEnabled
      ? "Proceed only with a bounded production run and proposal-quality review."
      : "Safe default: keep flags off until credentials, scan user, and cap are confirmed.",
    status: autoReviewEnabled && proactiveScanEnabled ? "ok" : "warn"
  });

  return checks;
}

function calendarChecks(): Check[] {
  return [
    envPresenceCheck(
      "#112",
      "Calendar required env",
      [
        "GOOGLE_CALENDAR_CLIENT_ID",
        "GOOGLE_CALENDAR_CLIENT_SECRET",
        "GOOGLE_CALENDAR_REDIRECT_URI",
        "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
      ],
      "Configure Google Cloud OAuth and production env, then run npm run calendar:prod-smoke."
    ),
    checkRedirectUri(),
    {
      detail: configured("OPENCLAW_SIGNALS_URL") && configured("OPENCLAW_TOKEN")
        ? "Live signals smoke inputs are present. Values were not printed."
        : "Live signals smoke inputs are not both set; env-only smoke can still run.",
      issue: "#112",
      label: "Optional live signals smoke",
      next: "Set OPENCLAW_SIGNALS_URL and OPENCLAW_TOKEN only from a trusted operator shell when checking the live response shape.",
      status: configured("OPENCLAW_SIGNALS_URL") && configured("OPENCLAW_TOKEN") ? "ok" : "warn"
    }
  ];
}

function migrationChecks(): Check[] {
  const missingFiles = MIGRATION_FILES.filter((path) => !fileExists(path));

  return [
    {
      detail: missingFiles.length > 0
        ? `Missing local migration file(s): ${missingFiles.join(", ")}.`
        : "All three in-scope migration files exist locally.",
      issue: "#236",
      label: "Migration files",
      next: missingFiles.length > 0
        ? "Stop and restore the expected migration files before production verification."
        : "Load production Supabase env and run npm run migrations:verify.",
      status: missingFiles.length > 0 ? "blocked" : "ok"
    },
    envPresenceCheck(
      "#236",
      "Migration verifier env",
      [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
      ],
      "Load production Supabase env, then run npm run migrations:verify. The verifier performs SELECT/count probes only."
    ),
    {
      detail: configured("OPENCLAW_TALLY_BASE_URL") && configured("OPENCLAW_PLAID_REFRESH_TOKEN")
        ? "OpenClaw Plaid refresh probe inputs are present. Values were not printed."
        : "OpenClaw Plaid refresh probe inputs are not both set; manual signed-in Plaid sync remains the required live check.",
      issue: "#236",
      label: "Optional OpenClaw refresh probe",
      next: "Use npm run openclaw:plaid-refresh only after the deployed server also has OPENCLAW_PLAID_REFRESH_TOKEN configured.",
      status: configured("OPENCLAW_TALLY_BASE_URL") && configured("OPENCLAW_PLAID_REFRESH_TOKEN") ? "ok" : "warn"
    }
  ];
}

function liabilitiesChecks(): Check[] {
  const secretSet = configured("PLAID_PRODUCTION_SECRET") || configured("PLAID_SECRET");
  const plaidEnv = process.env.PLAID_ENV?.trim().toLowerCase();
  const missing = [
    configured("PLAID_CLIENT_ID") ? null : "PLAID_CLIENT_ID",
    configured("PLAID_ENV") ? null : "PLAID_ENV",
    secretSet ? null : "PLAID_PRODUCTION_SECRET or PLAID_SECRET"
  ].filter((value): value is string => Boolean(value));
  const liabilitiesEnabled = envFlag("PLAID_ENABLE_LIABILITIES");

  return [
    {
      detail: missing.length > 0
        ? `Missing ${missing.join(", ")}.`
        : "Plaid client id, environment, and secret are present. Values were not printed.",
      issue: "#290",
      label: "Plaid required env",
      next: missing.length > 0
        ? "Load production Plaid env before verifying due-date/minimum-payment activation."
        : "Confirm Plaid approved the Liabilities product before enabling the optional product flag.",
      status: missing.length > 0 ? "blocked" : "ok"
    },
    {
      detail: plaidEnv ? `PLAID_ENV=${plaidEnv}.` : "PLAID_ENV is not set.",
      issue: "#290",
      label: "Plaid production mode",
      next: plaidEnv === "production"
        ? "Continue with Liabilities approval confirmation and card reconnect verification."
        : "Use production Plaid env for the real due-date/minimum-payment verification; sandbox cannot close #290.",
      status: plaidEnv === "production" ? "ok" : "warn"
    },
    {
      detail: `PLAID_ENABLE_LIABILITIES=${liabilitiesEnabled ? "true" : "not true"}.`,
      issue: "#290",
      label: "Liabilities activation flag",
      next: liabilitiesEnabled
        ? "Verify approval in Plaid, then use Settings → Enable due dates to re-consent existing card connections."
        : "Safe default: keep off until Plaid confirms Liabilities approval; then set true in production and reconnect cards.",
      status: "warn"
    }
  ];
}

function printChecks(checks: Check[]) {
  for (const issue of ["#111", "#112", "#290", "#236"]) {
    console.log(issueHeader(issue));
    for (const check of checks.filter((item) => item.issue === issue)) {
      console.log(`${statusPrefix(check.status)} ${check.label}: ${check.detail}`);
      console.log(`         Next: ${check.next}`);
    }
    console.log("");
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const checks = [
    ...reimbursementChecks(),
    ...calendarChecks(),
    ...liabilitiesChecks(),
    ...migrationChecks()
  ];

  console.log("Production ops preflight for blocked issues #111, #112, #290, #236\n");
  console.log("Scope: local files + env presence/shape only. No network calls. No secret values printed.\n");
  printChecks(checks);

  const blockedCount = checks.filter((check) => check.status === "blocked").length;
  const warningCount = checks.filter((check) => check.status === "warn").length;
  console.log(`Summary: ${blockedCount} blocked, ${warningCount} warning(s).`);
  console.log("Run issue-specific helpers next: reimbursement:preflight, calendar:prod-smoke, migrations:verify, plus Plaid Liabilities approval/reconnect for #290.");

  if (strict && blockedCount > 0) {
    process.exit(1);
  }
}

main();
