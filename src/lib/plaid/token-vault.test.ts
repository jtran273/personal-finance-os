import assert from "node:assert/strict";
import test from "node:test";
import { decryptPlaidAccessToken, encryptPlaidAccessToken } from "./token-vault";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SANDBOX_SECRET",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "VERCEL_ENV",
  "VERCEL_URL"
] as const;

function withTokenVaultEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = new Map(ENV_KEYS.map((key) => [key, env[key]]));

  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }
}

const baseEnv = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  PLAID_CLIENT_ID: "client-id",
  PLAID_ENV: "production",
  PLAID_PRODUCTION_SECRET: "production-secret",
  PLAID_REDIRECT_URI: undefined,
  PLAID_SANDBOX_SECRET: undefined,
  PLAID_SECRET: undefined,
  VERCEL_URL: undefined
} satisfies Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

test("explicit Plaid token encryption key does not require Link redirect config during decrypt", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-production-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-123");
  });
});

test("legacy Plaid token key uses credentials without requiring Link redirect config", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-legacy-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-legacy-123");
  });
});

test("Plaid token decryption can read legacy ciphertext in production without an explicit key", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-production-legacy");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: "production"
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-legacy");
  });
});

test("Plaid token encryption still requires explicit key material in production", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => encryptPlaidAccessToken("access-token"),
      /PLAID_TOKEN_ENCRYPTION_KEY is required in production/
    );
  });
});
