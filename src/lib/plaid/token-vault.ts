import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPlaidCredentialConfig, getPlaidRuntimeEnvironment, PlaidConfigurationError } from "./config";

const TOKEN_VERSION = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";

export class PlaidTokenDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt Plaid access token.");
    this.name = "PlaidTokenDecryptionError";
  }
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function isStableTokenKeyRequired() {
  return getPlaidRuntimeEnvironment() === "production" || isProductionRuntime();
}

function hashKey(...parts: string[]) {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
}

function getLegacyTokenKey() {
  const config = getPlaidCredentialConfig();

  return hashKey(
    "personal-finance-os:plaid-access-token:v1",
    config.clientId,
    config.secret
  );
}

function getExplicitTokenKey() {
  const explicitKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();

  return explicitKey
    ? hashKey("personal-finance-os:plaid-access-token:explicit:v1", explicitKey)
    : null;
}

function getRequiredExplicitTokenKey() {
  const explicitKey = getExplicitTokenKey();

  if (explicitKey) {
    return explicitKey;
  }

  if (isStableTokenKeyRequired()) {
    throw new PlaidConfigurationError(
      "PLAID_TOKEN_ENCRYPTION_KEY is required when PLAID_ENV=production or the app runs in production. " +
      "Generate one with `openssl rand -base64 32`, store it unchanged in every production-like environment, " +
      "and reconnect any Plaid items whose existing ciphertext cannot be decrypted."
    );
  }

  return null;
}

function getPrimaryTokenKey() {
  const explicitKey = getRequiredExplicitTokenKey();

  if (explicitKey) {
    return explicitKey;
  }

  return getLegacyTokenKey();
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptPlaidAccessToken(accessToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ALGORITHM, getPrimaryTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, encode(iv), encode(tag), encode(ciphertext)].join(":");
}

export function decryptPlaidAccessToken(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(":");

  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Unsupported Plaid access token ciphertext.");
  }

  const primary = getRequiredExplicitTokenKey();
  const attemptedKeys = primary ? [primary] : [getLegacyTokenKey()];

  for (const key of attemptedKeys) {
    try {
      const decipher = createDecipheriv(TOKEN_ALGORITHM, key, decode(iv));
      decipher.setAuthTag(decode(tag));

      return Buffer.concat([decipher.update(decode(encrypted)), decipher.final()]).toString("utf8");
    } catch {
      // Fall through to the legacy fallback below when an explicit key is configured.
    }
  }

  if (primary) {
    try {
      const legacy = getLegacyTokenKey();
      if (!primary.equals(legacy)) {
        const decipher = createDecipheriv(TOKEN_ALGORITHM, legacy, decode(iv));
        decipher.setAuthTag(decode(tag));

        return Buffer.concat([decipher.update(decode(encrypted)), decipher.final()]).toString("utf8");
      }
    } catch (error) {
      if (error instanceof PlaidConfigurationError) {
        throw new PlaidTokenDecryptionError();
      }
    }
  }

  throw new PlaidTokenDecryptionError();
}
