import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { denied, driverVehicle } from "@/lib/driver-vehicle";
import { hostedRuntime } from "@/lib/runtime";
import { firestoreDriverNotificationStore } from "@/lib/driver-notification-store";
import { inboxFor, markAllNotificationsRead, markNotificationRead, type InboxNotification } from "@/lib/driver-change-events";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** The fields the driver app needs. Nothing internal (event ids, dedupe keys, push text) leaves the server. */
const publicItem = (item: InboxNotification) => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  detail: item.inboxText,
  priority: item.priority,
  serviceDate: item.serviceDate,
  runId: item.runId,
  createdAt: item.createdAt,
  ...(item.readAt ? { readAt: item.readAt } : {}),
});

export async function GET(request: NextRequest) {
  try {
    const vehicleId = await driverVehicle(request);
    const inbox = await inboxFor(firestoreDriverNotificationStore, vehicleId, 50);
    return NextResponse.json({ vehicleId, unreadCount: inbox.unreadCount, items: inbox.items.map(publicItem) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (hostedRuntime()) assertSameOrigin(request);
    const vehicleId = await driverVehicle(request);
    const body = await request.json().catch(() => null) as { action?: unknown; id?: unknown } | null;
    const now = new Date();
    if (body?.action === "mark-read") {
      if (typeof body.id !== "string" || !body.id || body.id.length > 200) throw denied("A notification is required.", "LOGISTICS_NOTIFICATION_ID_REQUIRED", 422);
      // Another vehicle's notification is indistinguishable from a missing one.
      if (!await markNotificationRead(firestoreDriverNotificationStore, vehicleId, body.id, now)) throw denied("We could not find that notification.", "LOGISTICS_NOTIFICATION_NOT_FOUND", 404);
    } else if (body?.action === "mark-all-read") {
      await markAllNotificationsRead(firestoreDriverNotificationStore, vehicleId, now);
    } else {
      throw denied("That notification action is not available.", "LOGISTICS_NOTIFICATION_ACTION_UNKNOWN", 422);
    }
    const inbox = await inboxFor(firestoreDriverNotificationStore, vehicleId, 50);
    return NextResponse.json({ vehicleId, unreadCount: inbox.unreadCount, items: inbox.items.map(publicItem) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
