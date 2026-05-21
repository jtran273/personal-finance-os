import { type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/auth";
import {
  createCalendarRouteWriteClient,
  disconnectGoogleCalendarConnection,
  CalendarRouteConfigurationError,
  GoogleCalendarConfigurationError,
  GoogleCalendarSelectionError,
  listGoogleCalendarConnections,
  refreshGoogleCalendarList,
  requireCalendarRouteUser,
  updateGoogleCalendarSelection
} from "@/lib/calendar";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";

export const runtime = "nodejs";

interface CalendarConnectionRouteProps {
  params: Promise<{
    connectionId: string;
  }>;
}

export async function PATCH(request: NextRequest, { params }: CalendarConnectionRouteProps) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps calendar connections read-only." }, { status: 403 });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  const { connectionId } = await params;
  if (!connectionId) {
    return jsonNoStore({ error: "Missing calendar connection id." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const selectedCalendarIds = body && typeof body === "object"
    ? (body as { selectedCalendarIds?: unknown }).selectedCalendarIds
    : null;

  try {
    const writeClient = createCalendarRouteWriteClient();
    const connection = await updateGoogleCalendarSelection(
      writeClient,
      context.user.id,
      connectionId,
      selectedCalendarIds
    );
    const connections = await listGoogleCalendarConnections(writeClient, context.user.id);
    return jsonNoStore({ connection, connections });
  } catch (error) {
    if (error instanceof GoogleCalendarSelectionError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_selection_update_failed", error);
    return jsonNoStore({ error: "Unable to update Google Calendar selection." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: CalendarConnectionRouteProps) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps calendar connections read-only." }, { status: 403 });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  const { connectionId } = await params;
  if (!connectionId) {
    return jsonNoStore({ error: "Missing calendar connection id." }, { status: 400 });
  }

  try {
    const writeClient = createCalendarRouteWriteClient();
    const connection = await refreshGoogleCalendarList(writeClient, context.user.id, connectionId);
    const connections = await listGoogleCalendarConnections(writeClient, context.user.id);
    return jsonNoStore({ connection, connections });
  } catch (error) {
    if (error instanceof GoogleCalendarSelectionError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_list_refresh_failed", error);
    return jsonNoStore({ error: "Unable to refresh Google Calendar choices." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: CalendarConnectionRouteProps) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps calendar connections read-only." }, { status: 403 });
  }

  const context = await requireCalendarRouteUser();
  if ("response" in context) return context.response;

  const { connectionId } = await params;
  if (!connectionId) {
    return jsonNoStore({ error: "Missing calendar connection id." }, { status: 400 });
  }

  try {
    const writeClient = createCalendarRouteWriteClient();
    const connection = await disconnectGoogleCalendarConnection(writeClient, context.user.id, connectionId);
    const connections = await listGoogleCalendarConnections(writeClient, context.user.id);
    return jsonNoStore({ connection, connections });
  } catch (error) {
    if (error instanceof GoogleCalendarConfigurationError || error instanceof CalendarRouteConfigurationError) {
      return jsonNoStore({ error: "Google Calendar integration is not configured." }, { status: 503 });
    }

    logSafeError("google_calendar_disconnect_failed", error);
    return jsonNoStore({ error: "Unable to disconnect Google Calendar." }, { status: 500 });
  }
}
