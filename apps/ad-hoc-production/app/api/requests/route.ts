import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { AD_HOC_CATEGORIES, AD_HOC_UNITS, isDate, isTime, londonBusinessDate, weekStart, type AdHocDraft } from "../../../lib/ad-hoc-domain";
import { archiveRequest, cancelRequest, createRequest, duplicateRequest, getRequest, listRequests, sendToCpu, updateRequest } from "../../../lib/ad-hoc-service";
import { requestActor } from "../../../lib/actor";
import { resolveOplocDestination } from "../../../lib/hub-oplocs";

const actor = requestActor;

const text = (max: number) => z.string().max(max);
const draft = z.object({
  eventName: text(120), serviceDate: z.string().refine(isDate, "Enter a valid service date."), requiredReadyTime: z.string().refine(isTime, "Enter a valid ready time."),
  category: z.enum(AD_HOC_CATEGORIES.map(item => item.value) as [string, ...string[]]), guestCount: z.number().int().positive().max(100000).optional(), notes: text(600).optional(),
  destination: z.object({ mode: z.enum(["oploc", "one_off"]), oplocId: text(200).optional(), label: text(160), address: text(400), contactName: text(120).optional(), contactPhone: text(40).optional(), deliveryInstructions: text(400).optional(), identity: text(200).optional() }),
  lines: z.array(z.object({ id: text(80).optional(), description: text(200), quantity: z.number().positive().max(100000), unit: z.enum(AD_HOC_UNITS), note: text(300).optional(), sortOrder: z.number().optional() })).max(100),
});
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), draft }),
  z.object({ action: z.literal("update"), id: z.string(), expectedVersion: z.number().int(), draft }),
  z.object({ action: z.literal("send"), id: z.string(), expectedVersion: z.number().int() }),
  z.object({ action: z.literal("archive"), id: z.string(), expectedVersion: z.number().int() }),
  z.object({ action: z.literal("cancel"), id: z.string(), expectedVersion: z.number().int(), reason: z.string().max(300) }),
  z.object({ action: z.literal("duplicate"), id: z.string() }),
]);

const fail = (error: unknown) => {
  const status = error instanceof z.ZodError ? 422 : (error as { status?: number }).status || 500;
  setDataTraceOutcome(status === 401 || status === 403 ? "DENIED" : "ERROR");
  const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: { message } }, { status });
};

export async function GET(req: NextRequest) {
  return withDataTrace({ app: "ad-hoc-production", action: "request.list", path: "/api/requests", dataset: "ad-hoc-production/requests", outcome: "SUCCESS" }, async () => {
    try {
      const who = await actor(req);
      const params = req.nextUrl.searchParams;
      const id = params.get("id");
      if (id) { const request = await getRequest(id); return request ? NextResponse.json({ request, actor: { name: who.name } }) : NextResponse.json({ error: { message: "Request not found." } }, { status: 404 }); }
      const from = params.get("from");
      return NextResponse.json({ requests: await listRequests(isDate(from) ? from : weekStart(londonBusinessDate()), Number(params.get("days")) || 7), actor: { name: who.name } });
    } catch (error) { return fail(error); }
  });
}

export async function POST(req: NextRequest) {
  return withDataTrace({ app: "ad-hoc-production", action: "request.mutate", path: "/api/requests", dataset: "ad-hoc-production/requests", outcome: "SUCCESS" }, async () => {
    try {
      const who = await actor(req);
      const input = body.parse(await req.json());
      const cookie = req.headers.get("cookie") || "";
      const checked = async (value: z.infer<typeof draft>) => ({ ...value, destination: await resolveOplocDestination({ identity: "", ...value.destination }, cookie) }) as AdHocDraft;
      switch (input.action) {
        case "create": return NextResponse.json({ request: await createRequest(await checked(input.draft), who) });
        case "update": return NextResponse.json({ request: await updateRequest(input.id, input.expectedVersion, await checked(input.draft), who) });
        case "send": {
          const current = await getRequest(input.id);
          const verified = current?.destination.mode === "oploc" ? await resolveOplocDestination(current.destination, cookie) : undefined;
          return NextResponse.json(await sendToCpu(input.id, input.expectedVersion, who, verified));
        }
        case "archive": return NextResponse.json({ request: await archiveRequest(input.id, input.expectedVersion, who) });
        case "cancel": return NextResponse.json({ request: await cancelRequest(input.id, input.expectedVersion, input.reason, who) });
        case "duplicate": return NextResponse.json({ request: await duplicateRequest(input.id, who) });
      }
    } catch (error) { return fail(error); }
  });
}
