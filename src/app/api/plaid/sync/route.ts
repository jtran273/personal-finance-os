import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { listPlaidConnections, syncPlaidConnections } from "@/lib/plaid/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const writeClient = createPlaidRouteWriteClient();
    const sync = await syncPlaidConnections(writeClient, context.user.id);
    const connections = await listPlaidConnections(writeClient, context.user.id);

    return NextResponse.json({ connections, sync });
  } catch (error) {
    return plaidRouteError(
      "plaid_sync_failed",
      error,
      "Unable to sync Plaid data."
    );
  }
}
