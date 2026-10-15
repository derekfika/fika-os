import { NextRequest, NextResponse } from "next/server";
import { assertAuthorisedOploc } from "@/lib/projection";
import { deliveredInErrorBody, resolveAccess } from "@/lib/server";
import { changeStandingOrder, createStandingOrder, generateDueStandingOrders } from "@/lib/grab-and-go-standing-service";
import { getGrabAndGoCataloguePackage } from "@/lib/grab-and-go-catalogue-client";
import { openAttention, type StandingOrder } from "@/lib/grab-and-go-standing";
import { deliverGrabHandoff, grabHandoffEvent, grabHandoffId } from "../../../../../lib/grab-and-go-handoff";
import { forwardProductionMaterialisation } from "../../../../../lib/production-client";
import { listStandingOrdersHosted } from "@/lib/grab-and-go-store";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function authorisedSite(request: NextRequest, requested?: string) {
  const resolved = await resolveAccess(request, "grab-and-go"); const selected = requested || (resolved.access.oplocIds.length === 1 ? resolved.access.oplocIds[0] : undefined);
  if (!selected) throw Object.assign(new Error("Select an OPLOC with Grab & Go enabled first."), { status: 422 });
  assertAuthorisedOploc(resolved.access, selected);
  return { selected, access: resolved.access };
}
/** After a fix to a template with an open attention record, retry that template now so a same-morning fix is not missed by the next day's run. Best effort; the daily job remains authoritative. */
async function retryIfNeedsAttention(template: StandingOrder) {
  if (!openAttention(template).length) return;
  try {
    const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || ""); const products = (await getGrabAndGoCataloguePackage()).catalogue.products;
    await generateDueStandingOrders({ products, standingOrderId: template.standingOrderId, deliver: order => hosted ? deliverGrabHandoff(grabHandoffId(order)) : forwardProductionMaterialisation(grabHandoffEvent(order).payload, { allowPending: true }) });
  } catch { /* the next scheduled run will retry */ }
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
    const body = await request.json() as { oplocId?: string; action?: string; deliveryDate?: string; standingOrderId?: string; expectedVersion?: number; weekdays?: unknown; endDate?: unknown; lines?: unknown };
    const { selected, access } = await authorisedSite(request, body.oplocId);
    if (body.action === "create") {
      if (!body.deliveryDate) return NextResponse.json({ error: { message: "The order to convert is required." } }, { status: 422 });
      return NextResponse.json({ standingOrder: await createStandingOrder({ oplocId: selected, sourceDeliveryDate: body.deliveryDate, weekdays: body.weekdays, endDate: body.endDate, actor: access.email }) }, { status: 201 });
    }
    if (!body.standingOrderId || !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: { message: "A standing order and its current version are required." } }, { status: 422 });
    const base = { oplocId: selected, standingOrderId: body.standingOrderId, expectedVersion: body.expectedVersion!, actor: access.email };
    switch (body.action) {
      case "edit": { const standingOrder = await changeStandingOrder({ ...base, change: { action: "edit", weekdays: body.weekdays, endDate: body.endDate, lines: body.lines } }); await retryIfNeedsAttention(standingOrder); return NextResponse.json({ standingOrder }); }
      case "pause": case "resume": case "stop": return NextResponse.json({ standingOrder: await changeStandingOrder({ ...base, change: { action: body.action } }) });
      case "update-from-order":
        if (!body.deliveryDate) return NextResponse.json({ error: { message: "The order to copy is required." } }, { status: 422 });
        { const standingOrder = await changeStandingOrder({ ...base, change: { action: "update-from-order", deliveryDate: body.deliveryDate } }); await retryIfNeedsAttention(standingOrder); return NextResponse.json({ standingOrder }); }
      default: return NextResponse.json({ error: { message: "Unknown standing-order action." } }, { status: 422 });
    }
  } catch (error) { return NextResponse.json(deliveredInErrorBody(error, "The standing order could not be saved."), { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
