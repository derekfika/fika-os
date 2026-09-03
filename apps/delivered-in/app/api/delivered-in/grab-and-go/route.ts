import { NextRequest, NextResponse } from "next/server";
import { applyOrderAction, availableDeliveryDates, deliveryCutoff, isBeforeOrderCutoff, rotationWeekForDate } from "@/lib/grab-and-go";
import { getGrabAndGoOrderHosted, listGrabAndGoOrdersHosted, saveGrabAndGoOrderHosted } from "@/lib/grab-and-go-store";
import { getGrabAndGoCataloguePackage } from "@/lib/grab-and-go-catalogue-client";
import { assertAuthorisedOploc } from "@/lib/projection";
import { resolveAccess } from "@/lib/server";
import { forwardProductionMaterialisation } from "../../../../lib/production-client";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

export const dynamic = "force-dynamic";

async function authorisedSite(request: NextRequest, requested?: string) {
  const resolved = await resolveAccess(request, "grab-and-go"); const selected = requested || (resolved.access.oplocIds.length === 1 ? resolved.access.oplocIds[0] : undefined);
  if (!selected) throw Object.assign(new Error("Select an OPLOC with Grab & Go enabled first."), { status: 422 });
  assertAuthorisedOploc(resolved.access, selected);
  return { selected, access: resolved.access };
}

async function handleGet(request: NextRequest) {
  try {
    const { selected } = await authorisedSite(request, request.nextUrl.searchParams.get("oplocId") || undefined); const now = new Date();
    const dates = new Map(availableDeliveryDates(now).map(date => [date.date, date]));
    const firstDate = [...dates.keys()].sort()[0] || now.toISOString().slice(0, 10); const startDate = new Date(`${firstDate}T00:00:00Z`); startDate.setUTCDate(startDate.getUTCDate() - 7); const endDate = new Date(`${firstDate}T00:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() + 29);
    const orders = await listGrabAndGoOrdersHosted(selected, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10));
    for (const order of orders) if (!dates.has(order.deliveryDate)) {
      const date = new Date(`${order.deliveryDate}T00:00:00Z`);
      dates.set(order.deliveryDate, { date: order.deliveryDate, rotationWeek: order.rotationWeek, weekday: date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }), cutoff: deliveryCutoff(order.deliveryDate).toISOString() });
    }
    const deliveryDates = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
    const orderByDate = new Map(orders.map(order => [order.deliveryDate, order]));
    const suggestedLinesByDate: Record<string, Array<{ productId: string; quantity: number }>> = {};
    for (const date of deliveryDates) {
      const previous = new Date(`${date.date}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
      const previousOrder = orderByDate.get(previous.toISOString().slice(0, 10));
      if (previousOrder?.status === "submitted") suggestedLinesByDate[date.date] = previousOrder.lines.map(line => ({ productId: line.productId, quantity: line.quantity }));
    }
    return NextResponse.json({ oplocId: selected, deliveryDates, orders: orders.map(order => ({ ...order, editable: order.status !== "cancelled" && isBeforeOrderCutoff(order.deliveryDate, now) })), suggestedLinesByDate, cutoffHour: 12 }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Grab & Go could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json() as { oplocId?: string; deliveryDate?: string; action?: "submit" | "amend" | "cancel"; expectedVersion?: number; lines?: Array<{ productId: string; quantity: number }> };
    if (!body.deliveryDate || !body.action || !["submit", "amend", "cancel"].includes(body.action)) return NextResponse.json({ error: { message: "A delivery date and valid order action are required." } }, { status: 422 });
    const { selected, access } = await authorisedSite(request, body.oplocId); const catalogue = (await getGrabAndGoCataloguePackage()).catalogue.products; const existing = await getGrabAndGoOrderHosted(selected, body.deliveryDate); const order = applyOrderAction(existing, { action: body.action, oplocId: selected, deliveryDate: body.deliveryDate, rotationWeek: rotationWeekForDate(body.deliveryDate), lines: body.lines, expectedVersion: body.expectedVersion, actor: access.email }, catalogue); await saveGrabAndGoOrderHosted(order, body.action === "submit" ? undefined : body.expectedVersion); const handoff = await forwardProductionMaterialisation({ sourceDomain: "grab-and-go", sourceEntityId: order.orderId, sourceVersion: order.version, destinationOplocId: order.oplocId, destinationLabel: order.oplocId, serviceDate: order.deliveryDate, requiredBy: `${order.deliveryDate}T08:00`, status: order.status, lines: order.lines.map(line => ({ sourceLineId: `${order.orderId}:line:${line.productId}`, canonicalItemId: line.productId, itemName: line.productName, quantity: line.quantity, unit: "item", workstream: "grab_and_go", })) }, { allowPending: true });
    return NextResponse.json({ order, handoff }, { status: existing ? 200 : 201 });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The Grab & Go order could not be saved." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
