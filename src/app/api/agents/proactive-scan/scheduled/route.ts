import { type NextRequest } from "next/server";
import {
  createDisabledProactiveScanResult,
  createProactiveScanServiceContext,
  ProactiveScanConfigurationError,
  type ProactiveScanMode,
  resolveProactiveScanEnabled,
  resolveProactiveScanHistoricalLookbackDays,
  resolveProactiveScanHistoricalMaxCandidates,
  resolveProactiveScanHistoricalMaxTransactions,
  resolveProactiveScanMaxTransactions,
  runProactiveReimbursementScan
} from "@/lib/agents/proactive-scan";
import { logSafeError } from "@/lib/security/logging";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedProactiveScanScheduleRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, process.env.CRON_SECRET);
}

function resolveRequestedScanMode(request: NextRequest): ProactiveScanMode {
  const url = request.nextUrl ?? new URL(request.url);
  const mode = url.searchParams.get("mode")?.trim().toLowerCase();
  return mode === "historical" || mode === "historical_backfill"
    ? "historical_backfill"
    : "recent";
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedProactiveScanScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled proactive scan is not authorized." }, { status: 401 });
  }

  const mode = resolveRequestedScanMode(request);
  const historical = mode === "historical_backfill";
  const maxTransactions = historical
    ? resolveProactiveScanHistoricalMaxTransactions()
    : resolveProactiveScanMaxTransactions();
  const maxCandidateProposals = historical
    ? resolveProactiveScanHistoricalMaxCandidates()
    : maxTransactions;
  const lookbackDays = historical
    ? resolveProactiveScanHistoricalLookbackDays()
    : undefined;
  if (!resolveProactiveScanEnabled()) {
    return jsonNoStore({
      scan: createDisabledProactiveScanResult({
        includeDisconnectedAccounts: historical,
        lookbackDays,
        maxCandidateProposals,
        maxTransactions,
        mode
      })
    });
  }

  try {
    const { client, userId } = createProactiveScanServiceContext();
    const scan = await runProactiveReimbursementScan(client, userId, {
      includeDisconnectedAccounts: historical,
      lookbackDays,
      maxCandidateProposals,
      maxTransactions,
      mode
    });

    return jsonNoStore({ scan }, { status: scan.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (error instanceof ProactiveScanConfigurationError) {
      return jsonNoStore({ error: "Proactive scan is not configured." }, { status: 503 });
    }

    logSafeError("proactive_scan_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to run proactive scan." }, { status: 500 });
  }
}
