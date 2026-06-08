import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { isAuthorizedProactiveScanScheduleRequest, POST } from "./route";

const originalCronSecret = process.env.CRON_SECRET;
const originalProactiveScanEnabled = process.env.PROACTIVE_SCAN_ENABLED;
const originalProactiveScanMaxTx = process.env.PROACTIVE_SCAN_MAX_TX;
const originalProactiveScanHistoryMaxTx = process.env.PROACTIVE_SCAN_HISTORY_MAX_TX;
const originalProactiveScanHistoryMaxCandidates = process.env.PROACTIVE_SCAN_HISTORY_MAX_CANDIDATES;
const originalProactiveScanHistoryLookbackDays = process.env.PROACTIVE_SCAN_HISTORY_LOOKBACK_DAYS;
const originalAutoReview = process.env.ENABLE_OPENAI_AUTO_REVIEW;

test.afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }

  if (originalProactiveScanEnabled === undefined) {
    delete process.env.PROACTIVE_SCAN_ENABLED;
  } else {
    process.env.PROACTIVE_SCAN_ENABLED = originalProactiveScanEnabled;
  }

  if (originalProactiveScanMaxTx === undefined) {
    delete process.env.PROACTIVE_SCAN_MAX_TX;
  } else {
    process.env.PROACTIVE_SCAN_MAX_TX = originalProactiveScanMaxTx;
  }

  if (originalProactiveScanHistoryMaxTx === undefined) {
    delete process.env.PROACTIVE_SCAN_HISTORY_MAX_TX;
  } else {
    process.env.PROACTIVE_SCAN_HISTORY_MAX_TX = originalProactiveScanHistoryMaxTx;
  }

  if (originalProactiveScanHistoryMaxCandidates === undefined) {
    delete process.env.PROACTIVE_SCAN_HISTORY_MAX_CANDIDATES;
  } else {
    process.env.PROACTIVE_SCAN_HISTORY_MAX_CANDIDATES = originalProactiveScanHistoryMaxCandidates;
  }

  if (originalProactiveScanHistoryLookbackDays === undefined) {
    delete process.env.PROACTIVE_SCAN_HISTORY_LOOKBACK_DAYS;
  } else {
    process.env.PROACTIVE_SCAN_HISTORY_LOOKBACK_DAYS = originalProactiveScanHistoryLookbackDays;
  }

  if (originalAutoReview === undefined) {
    delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
  } else {
    process.env.ENABLE_OPENAI_AUTO_REVIEW = originalAutoReview;
  }
});

test("scheduled proactive scan auth requires CRON_SECRET bearer token", () => {
  process.env.CRON_SECRET = "test-cron-secret";

  assert.equal(isAuthorizedProactiveScanScheduleRequest(new Headers()), false);
  assert.equal(
    isAuthorizedProactiveScanScheduleRequest(new Headers({ authorization: "Bearer wrong" })),
    false
  );
  assert.equal(
    isAuthorizedProactiveScanScheduleRequest(new Headers({ authorization: "Bearer test-cron-secret" })),
    true
  );
});

test("scheduled proactive scan returns a disabled result unless explicitly enabled", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.PROACTIVE_SCAN_MAX_TX = "7";
  delete process.env.PROACTIVE_SCAN_ENABLED;
  delete process.env.ENABLE_OPENAI_AUTO_REVIEW;

  const request = new Request("http://localhost/api/agents/proactive-scan/scheduled", {
    headers: {
      authorization: "Bearer test-cron-secret"
    },
    method: "POST"
  }) as NextRequest;
  const response = await POST(request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.scan.status, "disabled");
  assert.equal(body.scan.mode, "recent");
  assert.equal(body.scan.maxTransactions, 7);
  assert.equal(body.scan.maxCandidateProposals, 7);
  assert.equal(body.scan.includeDisconnectedAccounts, false);
  assert.equal(body.scan.scannedTransactionCount, 0);
  assert.equal(body.scan.createdProposalCount, 0);
  assert.equal(body.scan.suggestionProviderKind, null);
});

test("scheduled proactive scan can request a disabled historical backfill safely", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.PROACTIVE_SCAN_HISTORY_MAX_TX = "400";
  process.env.PROACTIVE_SCAN_HISTORY_MAX_CANDIDATES = "25";
  process.env.PROACTIVE_SCAN_HISTORY_LOOKBACK_DAYS = "365";
  delete process.env.PROACTIVE_SCAN_ENABLED;
  delete process.env.ENABLE_OPENAI_AUTO_REVIEW;

  const request = new Request("http://localhost/api/agents/proactive-scan/scheduled?mode=historical", {
    headers: {
      authorization: "Bearer test-cron-secret"
    },
    method: "POST"
  }) as NextRequest;
  const response = await POST(request);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.scan.status, "disabled");
  assert.equal(body.scan.mode, "historical_backfill");
  assert.equal(body.scan.maxTransactions, 400);
  assert.equal(body.scan.maxCandidateProposals, 25);
  assert.equal(body.scan.includeDisconnectedAccounts, true);
  assert.equal(typeof body.scan.fromDate, "string");
});
