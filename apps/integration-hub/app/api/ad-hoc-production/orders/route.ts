import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { adHocCaller, authoriseAdHocDestination, requireAdHocService } from "@/lib/ad-hoc-production-auth";
import { adHocOrderStatus, cancelAdHocProductionOrder, submitAdHocProductionOrder } from "@/lib/production-domain";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import type { AdHocOrderInput, AdHocSendCommand } from "../../../../../shared/ad-hoc-production-contract";

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
    if (command.action === "cancel") {
      try { return NextResponse.json(await cancelAdHocProductionOrder(caller.actor, command.requestId, command.reason), { headers: { "Cache-Control": "no-store" } }); }
      catch (error) {
        // errorResponse rewrites 404s into booking wording; keep the Ad-Hoc meaning explicit.
        if ((error as { code?: string }).code === "AD_HOC_ORDER_NOT_FOUND") return NextResponse.json({ error: { code: "AD_HOC_ORDER_NOT_FOUND", message: "No Production Order exists for this request." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
        throw error;
      }
    }
    // OPLOC authority is read only for OPLOC destinations; one-off destinations never touch it.
    const scope = !command.order.destinationAddress ? await caller.loadOplocs() : undefined;
    const { order, destination } = authoriseAdHocDestination(command, scope);
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
