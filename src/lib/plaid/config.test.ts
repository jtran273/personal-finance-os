import assert from "node:assert/strict";
import test from "node:test";
import { getPlaidConfig, getPlaidLinkTokenConfig, PlaidConfigurationError } from "./config";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SANDBOX_SECRET",
  "PLAID_SECRET",
  "VERCEL_URL"
] as const;

function withPlaidEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Plaid runtime config does not require redirect URI validity for sync-only operations", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: undefined,
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    const config = getPlaidConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, "http://localhost:3000/settings");
  });
});

test("Plaid Link token config still requires HTTPS redirect URI in production", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: undefined,
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    assert.throws(
      () => getPlaidLinkTokenConfig(),
      (error) => error instanceof PlaidConfigurationError
        && error.message === "Plaid production redirect URI must use HTTPS."
    );
  });
});
