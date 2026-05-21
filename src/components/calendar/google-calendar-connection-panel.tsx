"use client";

import { AlertCircle, CalendarDays, CheckCircle2, Plus, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface GoogleCalendarConnectionSummary {
  calendarSummary: string | null;
  calendars: Array<{
    id: string;
    primary: boolean;
    selected: boolean;
    summary: string;
  }>;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  lastSuccessfulSyncAt: string | null;
  selectedCalendarIds: string[];
  status: "active" | "error" | "revoked";
  updatedAt: string;
}

interface ConnectionsResponse {
  connections: GoogleCalendarConnectionSummary[];
}

interface AuthUrlResponse {
  authUrl: string;
}

interface DisconnectResponse {
  connection: GoogleCalendarConnectionSummary;
  connections: GoogleCalendarConnectionSummary[];
}

type CalendarConnectionMutationResponse = DisconnectResponse;

type RequestState = "idle" | "loading" | "connecting" | "disconnecting";

interface GoogleCalendarConnectionPanelProps {
  initialError?: string | null;
  initialSuccessMessage?: string | null;
  isDemo?: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Google Calendar request failed.";
    throw new Error(message);
  }

  return body as T;
}

function formatDate(value: string | null) {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

function sameCalendarSelection(first: string[], second: string[]) {
  if (first.length !== second.length) return false;
  const selected = new Set(first);
  return second.every((calendarId) => selected.has(calendarId));
}

export function GoogleCalendarConnectionPanel({
  initialError = null,
  initialSuccessMessage = null,
  isDemo = false
}: GoogleCalendarConnectionPanelProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<GoogleCalendarConnectionSummary[]>([]);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [refreshingCalendarId, setRefreshingCalendarId] = useState<string | null>(null);
  const [savingSelectionId, setSavingSelectionId] = useState<string | null>(null);
  const [selectionDrafts, setSelectionDrafts] = useState<Record<string, string[]>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccessMessage);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.status === "active") ?? null,
    [connections]
  );
  const lastReadAt = activeConnection?.lastSuccessfulSyncAt ?? null;

  const applyConnections = useCallback((nextConnections: GoogleCalendarConnectionSummary[]) => {
    setConnections(nextConnections);
    setSelectionDrafts(Object.fromEntries(nextConnections.map((connection) => [
      connection.id,
      connection.selectedCalendarIds.length > 0
        ? connection.selectedCalendarIds
        : connection.calendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id)
    ])));
  }, []);

  const loadConnections = useCallback(async () => {
    setRequestState("loading");
    try {
      const data = await fetch("/api/calendar/connections", { cache: "no-store" })
        .then((response) => readJson<ConnectionsResponse>(response));
      applyConnections(data.connections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Google Calendar connections.");
    } finally {
      setRequestState("idle");
    }
  }, [applyConnections]);

  useEffect(() => {
    let ignore = false;

    fetch("/api/calendar/connections", { cache: "no-store" })
      .then((response) => readJson<ConnectionsResponse>(response))
      .then((data) => {
        if (!ignore) applyConnections(data.connections);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load Google Calendar connections.");
        }
      })
      .finally(() => {
        if (!ignore) setRequestState("idle");
      });

    return () => {
      ignore = true;
    };
  }, [applyConnections]);

  const startConnection = async () => {
    setError(null);
    setSuccessMessage(null);
    if (isDemo) {
      setSuccessMessage("Demo mode does not connect Google Calendar. Sign in to enable real calendar context.");
      return;
    }

    setRequestState("connecting");

    try {
      const data = await fetch("/api/calendar/auth-url", {
        cache: "no-store",
        method: "POST"
      }).then((response) => readJson<AuthUrlResponse>(response));

      window.location.assign(data.authUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to start Google Calendar connection.");
      setRequestState("idle");
    }
  };

  const disconnectConnection = async (connection: GoogleCalendarConnectionSummary) => {
    if (connection.status === "revoked") return;
    if (isDemo) {
      setSuccessMessage("Demo calendar context is read-only.");
      return;
    }

    const confirmed = window.confirm("Disconnect Google Calendar? Tally will stop reading upcoming events for OpenClaw planning context.");
    if (!confirmed) return;

    setDisconnectingId(connection.id);
    setRequestState("disconnecting");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/calendar/connections/${connection.id}`, { method: "DELETE" })
        .then((response) => readJson<DisconnectResponse>(response));
      applyConnections(data.connections);
      setSuccessMessage("Google Calendar disconnected.");
      router.refresh();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Google Calendar.");
    } finally {
      setDisconnectingId(null);
      setRequestState("idle");
    }
  };

  const refreshCalendarChoices = async (connection: GoogleCalendarConnectionSummary) => {
    if (isDemo || connection.status === "revoked") return;

    setRefreshingCalendarId(connection.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/calendar/connections/${connection.id}`, { method: "POST" })
        .then((response) => readJson<CalendarConnectionMutationResponse>(response));
      applyConnections(data.connections);
      setSuccessMessage("Calendar choices refreshed.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh Google Calendar choices.");
    } finally {
      setRefreshingCalendarId(null);
    }
  };

  const toggleCalendarSelection = (connectionId: string, calendarId: string) => {
    setSelectionDrafts((current) => {
      const selected = new Set(current[connectionId] ?? []);
      if (selected.has(calendarId)) {
        selected.delete(calendarId);
      } else {
        selected.add(calendarId);
      }

      return {
        ...current,
        [connectionId]: Array.from(selected)
      };
    });
  };

  const saveCalendarSelection = async (connection: GoogleCalendarConnectionSummary) => {
    if (isDemo || connection.status === "revoked") return;

    const selectedCalendarIds = selectionDrafts[connection.id] ?? [];
    setSavingSelectionId(connection.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/calendar/connections/${connection.id}`, {
        body: JSON.stringify({ selectedCalendarIds }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      }).then((response) => readJson<CalendarConnectionMutationResponse>(response));
      applyConnections(data.connections);
      setSuccessMessage("Calendar selection saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save Google Calendar selection.");
    } finally {
      setSavingSelectionId(null);
    }
  };

  const isBusy = requestState === "loading"
    || requestState === "connecting"
    || requestState === "disconnecting"
    || refreshingCalendarId !== null
    || savingSelectionId !== null;

  return (
    <section className="settings-panel calendar-panel">
      <div className="settings-panel-head">
        <div>
          <div className="card-eyebrow">
            <ShieldCheck size={13} /> Google Calendar
          </div>
          <div className="settings-title">Calendar context</div>
        </div>
        <div className="calendar-actions">
          <button className="btn" disabled={isBusy} onClick={() => void loadConnections()} type="button">
            <RefreshCw size={14} />
            Refresh
          </button>
          <button className="btn btn-primary" disabled={isDemo || isBusy} onClick={() => void startConnection()} type="button">
            {requestState === "connecting" ? <RefreshCw size={14} /> : <Plus size={14} />}
            {isDemo ? "Read-only" : activeConnection ? "Reconnect" : "Connect"}
          </button>
        </div>
      </div>

      {isDemo ? (
        <div className="plaid-alert warning" role="status">
          <ShieldCheck size={14} />
          <span>Demo mode keeps calendar integration off. Sign in to connect Google Calendar.</span>
        </div>
      ) : null}

      <div className="plaid-sync-summary">
        <span>Last calendar read</span>
        <strong>{formatDate(lastReadAt)}</strong>
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
          <div className="plaid-empty">Loading calendar connection...</div>
        ) : null}
        {requestState !== "loading" && connections.length === 0 ? (
          <div className="plaid-empty">No Google Calendar connected.</div>
        ) : null}
        {connections.map((connection) => (
          <div className="plaid-connection-row" key={connection.id}>
            <div className="plaid-connection-icon">
              <CalendarDays size={16} />
            </div>
            <div className="plaid-connection-copy">
              <div className="settings-row-title">{connection.calendarSummary ?? "Primary calendar"}</div>
              <div className="settings-row-sub">
                Connected {formatDate(connection.createdAt)}
                {" | "}
                Last read {formatDate(connection.lastSuccessfulSyncAt)}
              </div>
              {connection.errorMessage ? (
                <div className="plaid-issue">
                  <strong>Read issue</strong>
                  <span>{connection.errorMessage}</span>
                </div>
              ) : null}
              {connection.status !== "revoked" ? (
                <div className="calendar-selection">
                  <div className="calendar-selection-head">
                    <span>Calendars</span>
                    <div className="calendar-selection-actions">
                      <button
                        className="btn btn-compact"
                        disabled={isDemo || isBusy}
                        onClick={() => void refreshCalendarChoices(connection)}
                        type="button"
                      >
                        <RefreshCw size={13} />
                        {refreshingCalendarId === connection.id ? "Refreshing" : "Refresh"}
                      </button>
                      {connection.calendars.length > 0 ? (
                        <button
                          className="btn btn-primary btn-compact"
                          disabled={
                            isDemo
                            || isBusy
                            || (selectionDrafts[connection.id] ?? []).length === 0
                            || sameCalendarSelection(selectionDrafts[connection.id] ?? [], connection.selectedCalendarIds)
                          }
                          onClick={() => void saveCalendarSelection(connection)}
                          type="button"
                        >
                          <CheckCircle2 size={13} />
                          {savingSelectionId === connection.id ? "Saving" : "Save"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {connection.calendars.length > 0 ? (
                    <div className="calendar-option-list">
                      {connection.calendars.map((calendar) => {
                        const selected = (selectionDrafts[connection.id] ?? []).includes(calendar.id);
                        return (
                          <label className="calendar-option" key={calendar.id}>
                            <input
                              checked={selected}
                              disabled={isDemo || isBusy}
                              onChange={() => toggleCalendarSelection(connection.id, calendar.id)}
                              type="checkbox"
                            />
                            <span title={calendar.summary}>{calendar.summary}</span>
                            {calendar.primary ? <em>primary</em> : null}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="settings-row-sub">Calendar choices not loaded.</div>
                  )}
                </div>
              ) : null}
            </div>
            <span className={`plaid-status ${connection.status}`}>{connection.status}</span>
            {connection.status !== "revoked" ? (
              <button
                className="btn btn-danger plaid-disconnect"
                disabled={isDemo || isBusy}
                onClick={() => void disconnectConnection(connection)}
                type="button"
              >
                <Unplug size={14} />
                {disconnectingId === connection.id ? "Disconnecting" : "Disconnect"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
