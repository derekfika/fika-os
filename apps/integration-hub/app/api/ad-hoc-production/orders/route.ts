import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { adHocCaller, requireAdHocService, type AdHocCaller } from "@/lib/ad-hoc-production-auth";
import { adHocOrderStatus, cancelAdHocProductionOrder, submitAdHocProductionOrder } from "@/lib/production-domain";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { adHocOneOffDestinationId, adHocSendKey, type AdHocOrderInput, type AdHocSendCommand } from "../../../../../shared/ad-hoc-production-contract";

const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Line = z.object({ sourceLineId: text(80), itemName: text(200), customerQuantity: z.number().positive().max(100000), customerUnit: text(40), productionQuantity: z.number().positive().max(100000), productionUnit: text(40), notes: z.string().trim().max(300).optional() }).strict();
const Order = z.object({
  clientName: text(120), productionCategory: z.enum(["delivered_in", "fine_dining", "hospitality", "events", "grab_and_go", "other"]), serviceDate: date,
  deliveryDateTime: z.string().max(40), requiredBy: z.string().max(40), serviceWindow: z.object({ startTime: time, endTime: time.optional() }).strict(),
  destinationOplocId: text(200), requiresDelivery: z.literal(true), deliveryLocation: text(160),
  destinationAddress: z.object({ identity: text(200), label: text(160), address: text(400), deliveryInstructions: z.string().trim().max(400).optional(), contact: z.string().trim().max(200).optional() }).strict().optional(),
  contact: z.string().trim().max(200).optional(), serviceType: text(160), pax: z.number().int().positive().max(100000), priority: z.literal("normal"),
  sourceReference: text(80), sourceEntityId: text(120), sourceVersion: z.number().int().positive(), stableSourceIdentity: z.literal(true), notes: z.string().trim().max(600).optional(),
  lines: z.array(Line).min(1).max(100),
}).strict() satisfies z.ZodType<AdHocOrderInput>;
const Send = z.object({ action: z.literal("send"), requestId: text(120), requestVersion: z.number().int().positive(), idempotencyKey: text(200), order: Order }).strict() satisfies z.ZodType<AdHocSendCommand>;
const Cancel = z.object({ action: z.literal("cancel"), requestId: text(120), reason: text(300) }).strict();
const Command = z.discriminatedUnion("action", [Send, Cancel]);

const unprocessable = (message: string) => Object.assign(new Error(message), { status: 422, code: "AD_HOC_INVALID_ORDER" });

/**
 * The Hub is the authority for the destination. An OPLOC must be one the caller
 * may use (aliases resolved through Hub redirects) and its label comes from Hub
 * authority, not the caller. A one-off destination must carry exactly the
 * request-scoped identity, so a forged OPLOC-looking id can never pose as one.
 */
function authoriseDestination(command: AdHocSendCommand, caller: AdHocCaller): { order: AdHocOrderInput; destination: { oplocId?: string; label: string; address?: string } } {
  const { order, requestId } = command;
  if (order.sourceEntityId !== requestId) throw unprocessable("The order does not belong to this request.");
  if (order.sourceVersion !== command.requestVersion) throw unprocessable("The order version does not match the request version.");
  if (command.idempotencyKey !== adHocSendKey(requestId, command.requestVersion)) throw unprocessable("The idempotency key does not match the request version.");
  const oneOffId = adHocOneOffDestinationId(requestId);
  if (order.destinationAddress) {
    if (order.destinationOplocId !== oneOffId || order.destinationAddress.identity !== oneOffId) throw unprocessable("A one-off destination must use the request-scoped identity.");
    return { order, destination: { label: order.destinationAddress.label, address: order.destinationAddress.address } };
  }
  if (order.destinationOplocId.startsWith("adhoc-destination:")) throw unprocessable("A one-off destination requires an address snapshot.");
  const canonicalId = caller.access.redirects?.[order.destinationOplocId] || order.destinationOplocId;
  const oploc = caller.access.oplocs.find(candidate => candidate.canonicalId === canonicalId);
  if (!oploc) throw Object.assign(new Error("That destination is not an active OPLOC you are authorised to use."), { status: 422, code: "AD_HOC_DESTINATION_NOT_AUTHORISED" });
  return { order: { ...order, destinationOplocId: oploc.canonicalId, deliveryLocation: oploc.label }, destination: { oplocId: oploc.canonicalId, label: oploc.label, ...(oploc.address ? { address: oploc.address } : {}) } };
}

async function handleGet(request: NextRequest) {
  try {
    requireAdHocService(request);
    await adHocCaller(request);
    const requestId = request.nextUrl.searchParams.get("requestId")?.trim();
    if (!requestId) throw unprocessable("A request id is required.");
    const status = await adHocOrderStatus(requestId);
    if (!status) return NextResponse.json({ error: { code: "AD_HOC_ORDER_NOT_FOUND", message: "No Production Order exists for this request." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, request.headers.get("x-request-id") || undefined); }
}

async function handlePost(request: NextRequest) {
  try {
    requireAdHocService(request);
    const caller = await adHocCaller(request);
    const command = Command.parse(await request.json().catch(() => { throw unprocessable("A JSON body is required."); }));
    if (command.action === "cancel") return NextResponse.json(await cancelAdHocProductionOrder(caller.actor, command.requestId, command.reason), { headers: { "Cache-Control": "no-store" } });
    const { order, destination } = authoriseDestination(command, caller);
    const result = await submitAdHocProductionOrder(caller.actor, order, command.idempotencyKey);
    return NextResponse.json({ ...result, destination }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(unprocessable(error.issues.map(issue => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ")), request.headers.get("x-request-id") || undefined);
    return errorResponse(error, request.headers.get("x-request-id") || undefined);
  }
}

export async function GET(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.ad-hoc-production.order-status", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request));
}
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "integration-hub", action: "integration-hub.ad-hoc-production.order-command", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request));
}
