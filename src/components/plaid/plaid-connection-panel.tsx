"use client";

import { AlertCircle, CheckCircle2, Landmark, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PlaidConnectionSummary {
  availableProducts: string[];
  billedProducts: string[];
  consentExpiresAt: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  institutionName: string;
  lastSuccessfulSyncAt: string | null;
  plaidInstitutionId: string | null;
  status: "active" | "error" | "revoked";
  updatedAt: string;
}

interface ConnectionsResponse {
  connections: PlaidConnectionSummary[];
}

interface LinkTokenResponse {
  expiration: string;
  linkToken: string;
}

interface ExchangeResponse {
  connection: PlaidConnectionSummary;
  syncError: string | null;
}

interface SyncRunSummary {
  accountsUpserted: number;
  balanceSnapshotsUpserted: number;
  failed: number;
  rawTransactionsUpserted: number;
  succeeded: number;
  totalItems: number;
}

interface SyncResponse {
  connections: PlaidConnectionSummary[];
  sync: SyncRunSummary;
}

type RequestState = "idle" | "loading" | "exchanging" | "syncing";

function formatConnectedDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatSyncDate(value: string | null) {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Plaid request failed.";
    throw new Error(message);
  }

  return body as T;
}

export function PlaidConnectionPanel() {
  const [connections, setConnections] = useState<PlaidConnectionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const openedTokenRef = useRef<string | null>(null);
  const [openRequested, setOpenRequested] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const connectedInstitutionCount = useMemo(
    () => new Set(connections.map((connection) => connection.plaidInstitutionId ?? connection.institutionName)).size,
    [connections]
  );
  const lastSyncAt = useMemo(() => {
    const values = connections
      .map((connection) => connection.lastSuccessfulSyncAt)
      .filter((value): value is string => Boolean(value));

    return values.length > 0
      ? values.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
      : null;
  }, [connections]);

  useEffect(() => {
    let ignore = false;

    fetch("/api/plaid/connections", { cache: "no-store" })
      .then((response) =>
        readJson<ConnectionsResponse>(response)
      )
      .then((data) => {
        if (!ignore) setConnections(data.connections);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load Plaid connections.");
        }
      })
      .finally(() => {
        if (!ignore) setRequestState("idle");
      });

    return () => {
      ignore = true;
    };
  }, []);

  const exchangePublicToken = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    setRequestState("exchanging");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch("/api/plaid/exchange", {
        body: JSON.stringify({
          institution: metadata.institution
            ? {
              institutionId: metadata.institution.institution_id,
              name: metadata.institution.name
            }
            : null,
          publicToken
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }).then((response) => readJson<ExchangeResponse>(response));

      setConnections((current) => [
        data.connection,
        ...current.filter((connection) => connection.id !== data.connection.id)
      ]);
      setSuccessMessage(`${data.connection.institutionName} connected${data.syncError ? "." : " and synced."}`);
      if (data.syncError) setError(data.syncError);
      setLinkToken(null);
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Unable to finish the Plaid connection.");
    } finally {
      setRequestState("idle");
    }
  }, []);

  const { open, ready } = usePlaidLink({
    onExit: (linkError) => {
      setOpenRequested(false);
      if (linkError) {
        setError("Plaid Link closed before the institution was connected.");
      }
    },
    onSuccess: (publicToken, metadata) => {
      setOpenRequested(false);
      void exchangePublicToken(publicToken, metadata);
    },
    token: linkToken
  });

  useEffect(() => {
    if (!linkToken || !openRequested || !ready || openedTokenRef.current === linkToken) return;

    openedTokenRef.current = linkToken;
    open();
  }, [linkToken, open, openRequested, ready]);

  const startPlaidLink = async () => {
    setError(null);
    setSuccessMessage(null);

    if (linkToken && ready) {
      open();
      return;
    }

    setRequestState("loading");

    try {
      const data = await fetch("/api/plaid/link-token", { method: "POST" }).then((response) =>
        readJson<LinkTokenResponse>(response)
      );
      openedTokenRef.current = null;
      setLinkToken(data.linkToken);
      setOpenRequested(true);
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : "Unable to create a Plaid Link token.");
    } finally {
      setRequestState("idle");
    }
  };

  const syncConnections = async () => {
    setRequestState("syncing");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch("/api/plaid/sync", { method: "POST" }).then((response) =>
        readJson<SyncResponse>(response)
      );

      setConnections(data.connections);
      if (data.sync.failed > 0) {
        setError(`Sync failed for ${data.sync.failed} Plaid item${data.sync.failed === 1 ? "" : "s"}.`);
        setSuccessMessage(
          data.sync.succeeded > 0
            ? `Synced ${data.sync.succeeded} of ${data.sync.totalItems} Plaid items.`
            : null
        );
      } else {
        setSuccessMessage(
          `Synced ${data.sync.rawTransactionsUpserted} transactions and ${data.sync.accountsUpserted} accounts.`
        );
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to sync Plaid data.");
    } finally {
      setRequestState("idle");
    }
  };

  const isBusy = requestState === "loading" || requestState === "exchanging" || openRequested;
  const isSyncing = requestState === "syncing";

  return (
    <section className="settings-panel plaid-panel">
      <div className="settings-panel-head">
        <div>
          <div className="card-eyebrow">
            <ShieldCheck size={13} /> Plaid Sandbox
          </div>
          <div className="settings-title">Bank connections</div>
        </div>
        <div className="plaid-actions">
          <button
            className="btn"
            disabled={isBusy || isSyncing || connections.length === 0}
            onClick={syncConnections}
            type="button"
          >
            <RefreshCw size={14} />
            {isSyncing ? "Syncing" : "Sync"}
          </button>
          <button className="btn btn-primary" disabled={isBusy || isSyncing} onClick={startPlaidLink} type="button">
            {requestState === "exchanging" ? <RefreshCw size={14} /> : <Plus size={14} />}
            {requestState === "exchanging" ? "Saving" : "Connect"}
          </button>
        </div>
      </div>

      <div className="plaid-metrics">
        <div className="setting-metric">
          <div className="setting-metric-value">{connections.length}</div>
          <div className="settings-row-sub">Items</div>
        </div>
        <div className="setting-metric">
          <div className="setting-metric-value">{connectedInstitutionCount}</div>
          <div className="settings-row-sub">Institutions</div>
        </div>
        <div className="setting-metric">
          <div className="setting-metric-value sync-date">{formatSyncDate(lastSyncAt)}</div>
          <div className="settings-row-sub">Last sync</div>
        </div>
      </div>

      {error ? (
        <div className="plaid-alert error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : null}
      {successMessage ? (
        <div className="plaid-alert success">
          <CheckCircle2 size={14} />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <div className="plaid-connection-list">
        {requestState === "loading" && connections.length === 0 ? (
          <div className="plaid-empty">Loading institutions...</div>
        ) : null}
        {requestState !== "loading" && connections.length === 0 ? (
          <div className="plaid-empty">No Plaid institutions connected.</div>
        ) : null}
        {connections.map((connection) => (
          <div className="plaid-connection-row" key={connection.id}>
            <div className="plaid-connection-icon">
              <Landmark size={16} />
            </div>
            <div className="plaid-connection-copy">
              <div className="settings-row-title">{connection.institutionName}</div>
              <div className="settings-row-sub">
                Connected {formatConnectedDate(connection.createdAt)}
                {" | "}
                Last sync {formatSyncDate(connection.lastSuccessfulSyncAt)}
                {connection.errorCode
                  ? ` | ${connection.errorCode}${connection.errorMessage ? `: ${connection.errorMessage}` : ""}`
                  : ""}
              </div>
            </div>
            <span className={`plaid-status ${connection.status}`}>{connection.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
