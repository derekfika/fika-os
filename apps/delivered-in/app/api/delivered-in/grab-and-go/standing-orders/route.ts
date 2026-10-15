import { NextRequest, NextResponse } from "next/server";
import { assertAuthorisedOploc } from "@/lib/projection";
import { deliveredInErrorBody, resolveAccess } from "@/lib/server";
import { changeStandingOrder, createStandingOrder } from "@/lib/grab-and-go-standing-service";
import { listStandingOrdersHosted } from "@/lib/grab-and-go-store";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function authorisedSite(request: NextRequest, requested?: string) {
  const resolved = await resolveAccess(request, "grab-and-go"); const selected = requested || (resolved.access.oplocIds.length === 1 ? resolved.access.oplocIds[0] : undefined);
  if (!selected) throw Object.assign(new Error("Select an OPLOC with Grab & Go enabled first."), { status: 422 });
  assertAuthorisedOploc(resolved.access, selected);
  return { selected, access: resolved.access };
}
const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

async function handleGet(request: NextRequest) {
  try {
    const { selected } = await authorisedSite(request, request.nextUrl.searchParams.get("oplocId") || undefined);
    const standingOrders = (await listStandingOrdersHosted({ oplocId: selected })).filter(item => item.status !== "stopped");
    return NextResponse.json({ oplocId: selected, standingOrders }, noStore);
  } catch (error) { return NextResponse.json(deliveredInErrorBody(error, "Standing orders could not be loaded."), { status: Number((error as { status?: number }).status) || 502 }); }
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json() as { oplocId?: string; action?: string; deliveryDate?: string; standingOrderId?: string; expectedVersion?: number; weekdays?: unknown; endDate?: unknown };
    const { selected, access } = await authorisedSite(request, body.oplocId);
    if (body.action === "create") {
      if (!body.deliveryDate) return NextResponse.json({ error: { message: "The order to convert is required." } }, { status: 422 });
      return NextResponse.json({ standingOrder: await createStandingOrder({ oplocId: selected, sourceDeliveryDate: body.deliveryDate, weekdays: body.weekdays, endDate: body.endDate, actor: access.email }) }, { status: 201 });
    }
    if (!body.standingOrderId || !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: { message: "A standing order and its current version are required." } }, { status: 422 });
    const base = { oplocId: selected, standingOrderId: body.standingOrderId, expectedVersion: body.expectedVersion!, actor: access.email };
    switch (body.action) {
      case "edit": return NextResponse.json({ standingOrder: await changeStandingOrder({ ...base, change: { action: "edit", weekdays: body.weekdays, endDate: body.endDate === undefined ? undefined : body.endDate } }) });
      case "pause": case "resume": case "stop": return NextResponse.json({ standingOrder: await changeStandingOrder({ ...base, change: { action: body.action } }) });
      case "update-from-order":
        if (!body.deliveryDate) return NextResponse.json({ error: { message: "The order to copy is required." } }, { status: 422 });
        return NextResponse.json({ standingOrder: await changeStandingOrder({ ...base, change: { action: "update-from-order", deliveryDate: body.deliveryDate } }) });
      default: return NextResponse.json({ error: { message: "Unknown standing-order action." } }, { status: 422 });
    }
  } catch (error) { return NextResponse.json(deliveredInErrorBody(error, "The standing order could not be saved."), { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
