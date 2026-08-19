import { NextRequest, NextResponse } from "next/server";
import { applyOrderAction, availableDeliveryDates, deliveryCutoff, isBeforeOrderCutoff, rotationWeekForDate } from "@/lib/grab-and-go";
import { readGrabAndGoCatalogue, getGrabAndGoOrder, listGrabAndGoOrders, saveGrabAndGoOrder } from "@/lib/grab-and-go-store";
import { assertAuthorisedOploc } from "@/lib/projection";
import { resolveAccess } from "@/lib/server";

export const dynamic = "force-dynamic";

async function authorisedSite(request: NextRequest, requested?: string) {
  const resolved = await resolveAccess(request); const selected = requested || (resolved.access.oplocIds.length === 1 ? resolved.access.oplocIds[0] : undefined);
  if (!selected) throw Object.assign(new Error("Select an authorised Delivered-In site first."), { status: 422 });
  assertAuthorisedOploc(resolved.access, selected);
  return { selected, access: resolved.access };
}

export async function GET(request: NextRequest) {
  try {
    const { selected } = await authorisedSite(request, request.nextUrl.searchParams.get("oplocId") || undefined); const now = new Date();
    const orders = listGrabAndGoOrders(selected);
    const dates = new Map(availableDeliveryDates(now).map(date => [date.date, date]));
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
    return NextResponse.json({ oplocId: selected, catalogue: readGrabAndGoCatalogue(), deliveryDates, orders: orders.map(order => ({ ...order, editable: order.status !== "cancelled" && isBeforeOrderCutoff(order.deliveryDate, now) })), suggestedLinesByDate, cutoffHour: 12 }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Grab & Go could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { oplocId?: string; deliveryDate?: string; action?: "submit" | "amend" | "cancel"; lines?: Array<{ productId: string; quantity: number }> };
    if (!body.deliveryDate || !body.action || !["submit", "amend", "cancel"].includes(body.action)) return NextResponse.json({ error: { message: "A delivery date and valid order action are required." } }, { status: 422 });
    const { selected, access } = await authorisedSite(request, body.oplocId); const catalogue = readGrabAndGoCatalogue(); const existing = getGrabAndGoOrder(selected, body.deliveryDate); const order = applyOrderAction(existing, { action: body.action, oplocId: selected, deliveryDate: body.deliveryDate, rotationWeek: rotationWeekForDate(body.deliveryDate), lines: body.lines, actor: access.email }, catalogue); saveGrabAndGoOrder(order);
    return NextResponse.json({ order }, { status: existing ? 200 : 201 });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The Grab & Go order could not be saved." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
