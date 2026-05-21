import assert from "node:assert/strict";
import test from "node:test";
import type { FinanceSupabaseClient, GoogleCalendarConnectionRow } from "@/lib/db";
import {
  buildGoogleCalendarAuthUrl,
  exchangeGoogleCalendarCode,
  GoogleCalendarScopeError,
  GoogleCalendarSelectionError,
  loadGoogleCalendarAccessToken,
  loadUpcomingCalendarContext,
  listGoogleCalendars,
  listGoogleCalendarEvents,
  parseGoogleCalendarEvents,
  refreshGoogleCalendarList,
  refreshGoogleCalendarAccessToken,
  updateGoogleCalendarSelection
} from "./service";
import { getGoogleCalendarConfig, GOOGLE_CALENDAR_READONLY_SCOPE } from "./config";
import { encryptGoogleCalendarToken } from "./token-vault";

async function withCalendarEnv<T>(env: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();

  Object.entries(env).forEach(([key, value]) => {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    return await run();
  } finally {
    previous.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

function responseJson(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  }));
}

interface CalendarUpdateCall {
  inFilters: Array<{ column: string; values: readonly unknown[] }>;
  payload: Record<string, unknown>;
}

function createCalendarConnectionClient(
  connection: GoogleCalendarConnectionRow,
  updates: CalendarUpdateCall[]
): FinanceSupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "google_calendar_connections");

      const inFilters: CalendarUpdateCall["inFilters"] = [];
      let payload: Record<string, unknown> | null = null;
      let single = false;

      const builder = {
        eq() {
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          inFilters.push({ column, values });
          return builder;
        },
        limit() {
          return builder;
        },
        order() {
          return builder;
        },
        select() {
          return builder;
        },
        single() {
          single = true;
          return builder;
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          const data = payload
            ? (single ? { ...connection, ...payload } : [])
            : (single ? connection : [connection]);

          if (payload) updates.push({ inFilters, payload });
          return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
        },
        update(value: Record<string, unknown>) {
          payload = value;
          return builder;
        }
      };

      return builder;
    }
  } as unknown as FinanceSupabaseClient;
}

const calendarEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: "calendar-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret",
  GOOGLE_CALENDAR_REDIRECT_URI: undefined,
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: "calendar-token-key",
  NEXT_PUBLIC_APP_URL: "https://ledger.example.test",
  VERCEL_URL: undefined
};

function calendarConnection(input: Partial<GoogleCalendarConnectionRow> = {}): GoogleCalendarConnectionRow {
  return {
    access_token_ciphertext: encryptGoogleCalendarToken("access-current"),
    calendar_list: [],
    calendar_summary: "Primary calendar",
    created_at: "2026-05-13T11:00:00.000Z",
    error_code: null,
    error_message: null,
    expires_at: "2026-05-13T12:30:00.000Z",
    google_calendar_id: "primary",
    id: "calendar-connection-1",
    last_successful_sync_at: null,
    refresh_token_ciphertext: encryptGoogleCalendarToken("refresh-current"),
    scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    selected_calendar_ids: ["primary"],
    status: "active",
    token_type: "Bearer",
    updated_at: "2026-05-13T11:00:00.000Z",
    user_id: "user-1",
    ...input
  };
}

test("Google Calendar config does not fall back to ephemeral Vercel URLs", async () => {
  await withCalendarEnv({
    GOOGLE_CALENDAR_CLIENT_ID: "calendar-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret",
    GOOGLE_CALENDAR_REDIRECT_URI: undefined,
    NEXT_PUBLIC_APP_URL: undefined,
    VERCEL_URL: "preview-random.vercel.app"
  }, () => {
    assert.throws(() => getGoogleCalendarConfig(), /NEXT_PUBLIC_APP_URL/);
  });
});

test("Google Calendar auth URL requests readonly offline access only", async () => {
  await withCalendarEnv(calendarEnv, () => {
    const url = new URL(buildGoogleCalendarAuthUrl("state-123"));

    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("scope"), GOOGLE_CALENDAR_READONLY_SCOPE);
    assert.equal(url.searchParams.get("state"), "state-123");
    assert.equal(url.searchParams.get("redirect_uri"), "https://ledger.example.test/api/calendar/callback");
  });
});

test("Google Calendar token exchange and refresh enforce readonly scope", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const exchangeCalls: URLSearchParams[] = [];
    const exchangeFetcher: typeof fetch = async (_input, init) => {
      exchangeCalls.push(init?.body as URLSearchParams);
      return responseJson({
        access_token: "access-123",
        expires_in: 1800,
        refresh_token: "refresh-123",
        scope: GOOGLE_CALENDAR_READONLY_SCOPE,
        token_type: "Bearer"
      });
    };

    const exchanged = await exchangeGoogleCalendarCode("auth-code", {
      fetcher: exchangeFetcher,
      now: new Date("2026-05-13T12:00:00.000Z")
    });
    assert.equal(exchanged.refreshToken, "refresh-123");
    assert.equal(exchanged.expiresAt, "2026-05-13T12:30:00.000Z");
    assert.equal(exchangeCalls[0].get("grant_type"), "authorization_code");

    const refreshFetcher: typeof fetch = async (_input, init) => {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-123");
      return responseJson({
        access_token: "access-456",
        expires_in: 900,
        token_type: "Bearer"
      });
    };

    const refreshed = await refreshGoogleCalendarAccessToken("refresh-123", {
      fetcher: refreshFetcher,
      now: new Date("2026-05-13T12:00:00.000Z"),
      previousScope: GOOGLE_CALENDAR_READONLY_SCOPE
    });
    assert.equal(refreshed.accessToken, "access-456");
    assert.equal(refreshed.scope, GOOGLE_CALENDAR_READONLY_SCOPE);

    await assert.rejects(
      () => exchangeGoogleCalendarCode("auth-code", {
        fetcher: async () => responseJson({
          access_token: "access-789",
          expires_in: 1800,
          refresh_token: "refresh-789",
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer"
        }),
        now: new Date("2026-05-13T12:00:00.000Z")
      }),
      GoogleCalendarScopeError
    );
  });
});

test("Google Calendar read and refresh updates keep status guards", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const refreshUpdates: CalendarUpdateCall[] = [];
    const expiredConnection = calendarConnection({ expires_at: "2026-05-13T11:30:00.000Z" });
    const refreshedToken = await loadGoogleCalendarAccessToken(
      createCalendarConnectionClient(expiredConnection, refreshUpdates),
      "user-1",
      expiredConnection,
      {
        fetcher: async () => responseJson({
          access_token: "access-refreshed",
          expires_in: 1800,
          scope: GOOGLE_CALENDAR_READONLY_SCOPE,
          token_type: "Bearer"
        }),
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(refreshedToken, "access-refreshed");
    assert.deepEqual(refreshUpdates[0].inFilters, [{ column: "status", values: ["active", "error"] }]);

    const readUpdates: CalendarUpdateCall[] = [];
    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(calendarConnection(), readUpdates),
      "user-1",
      {
        fetcher: async () => responseJson({ items: [] }),
        generatedAt: "2026-05-13T12:00:00.000Z",
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(context.status, "ready");
    assert.deepEqual(readUpdates[0].inFilters, [{ column: "status", values: ["active", "error"] }]);
  });
});

test("Google Calendar context reads each selected calendar", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const requestedUrls: string[] = [];
    const connection = calendarConnection({
      calendar_list: [
        { id: "primary", primary: true, summary: "Primary calendar" },
        { id: "school@example.com", primary: false, summary: "School" }
      ],
      selected_calendar_ids: ["primary", "school@example.com"]
    });

    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(connection, []),
      "user-1",
      {
        fetcher: async (input) => {
          requestedUrls.push(String(input));
          const url = new URL(String(input));
          const eventTitle = url.pathname.includes("school%40example.com") ? "Class" : "Dinner";
          return responseJson({
            items: [{
              end: { dateTime: "2026-05-13T14:00:00.000Z" },
              start: { dateTime: "2026-05-13T13:00:00.000Z" },
              summary: eventTitle
            }]
          });
        },
        generatedAt: "2026-05-13T12:00:00.000Z",
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(context.status, "ready");
    assert.equal(context.events.length, 2);
    assert.ok(requestedUrls.some((url) => new URL(url).pathname.includes("/calendars/primary/events")));
    assert.ok(requestedUrls.some((url) => new URL(url).pathname.includes("/calendars/school%40example.com/events")));
  });
});

test("Google Calendar context keeps usable events when one selected calendar fails", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const updates: CalendarUpdateCall[] = [];
    const connection = calendarConnection({
      selected_calendar_ids: ["primary", "school@example.com"]
    });

    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(connection, updates),
      "user-1",
      {
        fetcher: async (input) => {
          const url = new URL(String(input));
          if (url.pathname.includes("school%40example.com")) {
            return responseJson({ error: "forbidden" }, 403);
          }

          return responseJson({
            items: [{
              end: { dateTime: "2026-05-13T14:00:00.000Z" },
              start: { dateTime: "2026-05-13T13:00:00.000Z" },
              summary: "Dinner"
            }]
          });
        },
        generatedAt: "2026-05-13T12:00:00.000Z",
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(context.status, "ready");
    assert.equal(context.events.length, 1);
    assert.equal(updates.at(-1)?.payload.status, "active");
  });
});

test("Google Calendar context marks the connection errored when every selected calendar fails", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const updates: CalendarUpdateCall[] = [];
    const context = await loadUpcomingCalendarContext(
      createCalendarConnectionClient(calendarConnection({ selected_calendar_ids: ["primary"] }), updates),
      "user-1",
      {
        fetcher: async () => responseJson({ error: "forbidden" }, 403),
        generatedAt: "2026-05-13T12:00:00.000Z",
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.equal(context.status, "error");
    assert.equal(updates.at(-1)?.payload.status, "error");
    assert.equal(updates.at(-1)?.payload.error_code, "CALENDAR_READ_FAILED");
  });
});

test("Google Calendar events parser ignores raw descriptions and attendees", () => {
  const events = parseGoogleCalendarEvents({
    items: [
      {
        attendees: [{ email: "guest@example.com" }],
        description: "private notes",
        end: { dateTime: "2026-05-14T03:00:00.000Z" },
        location: "Oakland, CA",
        start: { dateTime: "2026-05-14T01:00:00.000Z" },
        summary: "Dinner"
      },
      {
        start: { date: "2026-05-15" },
        status: "cancelled",
        summary: "Cancelled"
      }
    ]
  });

  assert.deepEqual(events, [
    {
      allDay: false,
      end: "2026-05-14T03:00:00.000Z",
      location: "Oakland, CA",
      start: "2026-05-14T01:00:00.000Z",
      title: "Dinner"
    }
  ]);
  assert.doesNotMatch(JSON.stringify(events), /guest@example\.com|private notes/);
});

test("Google Calendar calendar-list helper keeps readable non-deleted calendars", async () => {
  let requestedUrlText: string | null = null;
  const calendars = await listGoogleCalendars("access-token", {
    fetcher: async (input, init) => {
      requestedUrlText = String(input);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer access-token");
      return responseJson({
        items: [
          { accessRole: "owner", id: "primary", primary: true, summary: "Primary calendar" },
          { accessRole: "reader", id: "school@example.com", summary: "School calendar" },
          { accessRole: "freeBusyReader", id: "busy@example.com", summary: "Busy only" },
          { accessRole: "reader", deleted: true, id: "deleted@example.com", summary: "Deleted" }
        ]
      });
    }
  });

  assert.deepEqual(calendars, [
    { id: "primary", primary: true, selected: false, summary: "Primary calendar" },
    { id: "school@example.com", primary: false, selected: false, summary: "School calendar" }
  ]);
  assert.ok(requestedUrlText);
  assert.equal(new URL(requestedUrlText).searchParams.get("fields"), "items(id,summary,primary,accessRole,deleted)");
});

test("Google Calendar selection updates keep only readable stored calendars", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const updates: CalendarUpdateCall[] = [];
    const client = createCalendarConnectionClient(calendarConnection({
      calendar_list: [
        { id: "primary", primary: true, summary: "Primary calendar" },
        { id: "school@example.com", primary: false, summary: "School" }
      ],
      selected_calendar_ids: ["primary"]
    }), updates);

    const connection = await updateGoogleCalendarSelection(
      client,
      "user-1",
      "calendar-connection-1",
      ["school@example.com", "unknown@example.com", "school@example.com"]
    );

    assert.deepEqual(connection.selectedCalendarIds, ["school@example.com"]);
    assert.deepEqual(updates[0].payload, { selected_calendar_ids: ["school@example.com"] });

    await assert.rejects(
      () => updateGoogleCalendarSelection(client, "user-1", "calendar-connection-1", ["unknown@example.com"]),
      GoogleCalendarSelectionError
    );
  });
});

test("Google Calendar calendar-list refresh preserves readable selected calendars", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    const updates: CalendarUpdateCall[] = [];
    const connection = await refreshGoogleCalendarList(
      createCalendarConnectionClient(calendarConnection({
        calendar_list: [
          { id: "primary", primary: true, summary: "Primary calendar" },
          { id: "old@example.com", primary: false, summary: "Old" }
        ],
        selected_calendar_ids: ["old@example.com", "missing@example.com"]
      }), updates),
      "user-1",
      "calendar-connection-1",
      {
        fetcher: async () => responseJson({
          items: [
            { accessRole: "owner", id: "primary", primary: true, summary: "Primary calendar" },
            { accessRole: "reader", id: "school@example.com", summary: "School" }
          ]
        }),
        now: new Date("2026-05-13T12:00:00.000Z")
      }
    );

    assert.deepEqual(connection.selectedCalendarIds, ["primary"]);
    assert.deepEqual(updates[0].payload, {
      calendar_list: [
        { id: "primary", primary: true, summary: "Primary calendar" },
        { id: "school@example.com", primary: false, summary: "School" }
      ],
      selected_calendar_ids: ["primary"]
    });
  });
});

test("Google Calendar calendar-list refresh rejects empty readable choices", async () => {
  await withCalendarEnv(calendarEnv, async () => {
    await assert.rejects(
      () => refreshGoogleCalendarList(
        createCalendarConnectionClient(calendarConnection(), []),
        "user-1",
        "calendar-connection-1",
        {
          fetcher: async () => responseJson({ items: [] }),
          now: new Date("2026-05-13T12:00:00.000Z")
        }
      ),
      GoogleCalendarSelectionError
    );
  });
});

test("Google Calendar list helper sends bounded readonly request", async () => {
  let requestedUrlText: string | null = null;
  let requestedAuth: string | null = null;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrlText = String(input);
    requestedAuth = init?.headers instanceof Headers
      ? init.headers.get("Authorization")
      : (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    return responseJson({ items: [] });
  };

  const events = await listGoogleCalendarEvents("access-token", {
    calendarId: "school@example.com",
    fetcher,
    timeMax: "2026-05-27T12:00:00.000Z",
    timeMin: "2026-05-13T12:00:00.000Z"
  });

  assert.deepEqual(events, []);
  assert.equal(requestedAuth, "Bearer access-token");
  assert.ok(requestedUrlText);
  const requestedUrl = new URL(requestedUrlText);
  assert.ok(requestedUrl.pathname.includes("/calendars/school%40example.com/events"));
  assert.equal(requestedUrl.searchParams.get("timeMin"), "2026-05-13T12:00:00.000Z");
  assert.equal(requestedUrl.searchParams.get("timeMax"), "2026-05-27T12:00:00.000Z");
  assert.equal(requestedUrl.searchParams.get("singleEvents"), "true");
  assert.equal(requestedUrl.searchParams.get("maxResults"), "25");
  assert.equal(requestedUrl.searchParams.get("fields"), "items(status,start,end,summary,location)");
});
