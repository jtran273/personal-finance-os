# Calendar-Aware Finance Context

Issue #112 should be framed as calendar-aware finance context, not as a standalone calendar product inside Tally.

## Product Call

Tally should not try to become a calendar surface. Google Calendar already has a UI, and OpenClaw can already reason over James's schedule. The product value is narrower: upcoming commitments should help Tally and OpenClaw make better finance decisions.

The feature is worth keeping only when calendar data changes a finance answer, prompt, or warning.

High-value examples:

- upcoming travel or lodging changes safe-to-spend pressure,
- upcoming dinners or reservations improve shared-expense and reimbursement prompts,
- birthdays, gifts, weddings, and showers explain planned spend before transactions arrive,
- rideshare or delivery events make transaction review less ambiguous,
- OpenClaw briefings can ask whether upcoming commitments change the budget plan.

Low-value examples:

- showing a generic calendar list in Tally,
- duplicating Google Calendar details,
- adding more Settings UI without changing finance behavior,
- surfacing raw event descriptions, attendees, meeting links, or full locations.

## Ownership Boundary

Tally owns:

- Google OAuth consent and disconnect in Settings,
- encrypted refresh/access-token storage,
- a small, redacted, user-scoped calendar context packet,
- finance-specific interpretation such as planned-spend pressure and review/reimbursement hints,
- auditability and approval surfaces for any resulting finance action.

OpenClaw owns:

- reasoning over the Tally-provided context,
- deciding when to interrupt James,
- natural-language briefings and follow-up questions,
- routing any reply back to Tally-owned endpoints.

OpenClaw must not store Google tokens, raw calendar payloads, raw finance/provider data, or directly mutate Tally records.

## Recommended MVP

Build one concrete proof point: calendar-aware safe-to-spend and review briefing.

Required behavior:

1. Connect Google Calendar in Settings using read-only OAuth.
2. Read only a bounded upcoming window, currently 14 days and up to 25 events.
3. Convert events into a minimized context:
   - `title`, redacted and truncated,
   - `start`,
   - `end`,
   - `all_day`,
   - `locationCity`, not street address or meeting URL,
   - `suspected_category`.
4. Recognize at least these categories:
   - `travel`,
   - `lodging`,
   - `dining`,
   - `gift`,
   - `birthday`,
   - `wedding`,
   - `rideshare`,
   - `delivery`,
   - `other`.
5. Feed the resulting pressure into:
   - `/api/openclaw/signals`,
   - `budget_briefing` or OpenClaw briefing proposal,
   - safe-to-spend explanation or warning copy,
   - reimbursement/review prompts when event context makes a transaction more likely to be shared or planned.

## Acceptance Criteria

The feature is product-real when all of these are true:

- A signed-in production user can connect and disconnect Google Calendar from Settings.
- `/api/openclaw/signals` returns `calendarContext.status: "ready"` only while a calendar is connected.
- Live calendar context includes only bounded event fields:
  - `all_day`,
  - `end`,
  - `locationCity`,
  - `start`,
  - `suspected_category`,
  - `title`.
- Calendar context excludes attendee emails, descriptions, meeting URLs, raw Google payloads, OAuth tokens, secrets, and street-level locations.
- At least one live upcoming event changes a finance-facing output, such as:
  - a safe-to-spend explanation,
  - an OpenClaw budget briefing question,
  - a reimbursement/shared-expense prompt,
  - a transaction review prompt.
- Clean failure states exist for:
  - not configured,
  - auth denied,
  - expired OAuth state,
  - disconnected,
  - Google read error.

## Non-Goals

- Do not build a calendar viewer in Tally.
- Do not ingest descriptions, attendees, full locations, meeting links, attachments, or raw Google payloads.
- Do not create calendar events from Tally.
- Do not let OpenClaw mutate finance rows based only on calendar inference.
- Do not make generic daily calendar summaries a finance notification.

## Claude Code Build Notes

Prefer product paths that prove a finance decision changed because of the calendar signal.

Good implementation candidates:

- Extend `budget_briefing` output copy to mention upcoming travel/dining/gift/wedding pressure.
- Add a calendar-aware safe-to-spend warning reason, with bounded event category counts rather than event details.
- Add review/reimbursement heuristics that use event category and timing, not raw calendar text.
- Add tests proving unsafe fields are excluded and calendar context affects a finance-facing output.

Avoid spending time on:

- richer Settings UI,
- extra Google Calendar fields,
- multi-calendar management,
- generic schedule summaries.
