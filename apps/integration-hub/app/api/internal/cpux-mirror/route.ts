import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { mirrorEnabled, mirrorPreviewEnabled } from "../../../../../shared/cpux-calendar/google";
import { hospitalityCatchUp, replayHospitalityMirror } from "../../../../lib/cpux-mirror/queue";
import { getFikaRuntimeConfig } from "../../../../lib/runtime-config";
import { hospitalityMirrorSchedulerRequestAllowed } from "../../../../lib/cpux-mirror/scheduler-auth";
import { requireAuthmodAdminContext } from "../../../../lib/authmod-admin-context";
import { assertSameOrigin } from "../../../../lib/csrf";

export const runtime = "nodejs";
export const maxDuration = 300;
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deliver"), limit: z.number().int().min(1).max(5).default(3) }).strict(),
  z.object({ action: z.literal("catch-up"), from: z.string(), through: z.string(), after: z.object({ serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bookingId: z.string().min(1).max(200).regex(/^[^/]+$/) }).strict().optional(), approveHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
]);

export async function POST(request: NextRequest) {
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Calendar mirror command." }, { status: 400 });
  const input = parsed.data;
  let scheduler = false;
  try { scheduler = await hospitalityMirrorSchedulerRequestAllowed(request, getFikaRuntimeConfig()); } catch { scheduler = false; }
  const internal = internalTokenAllowed(request) || scheduler;
  if (!internal) {
    if (input.action !== "catch-up" || input.approveHash) return NextResponse.json({ error: "Only read-only Calendar diagnostics are available to operator sessions." }, { status: 403 });
    try {
      assertSameOrigin(request);
      const context = await requireAuthmodAdminContext(request);
      console.info("cpux.calendar.hospitality.catch_up_diagnostic", { actorId: context.principal.id, from: input.from, through: input.through, cursor: input.after ? "present" : "none" });
    } catch {
      return NextResponse.json({ error: "An authenticated AUTHMOD administrator is required." }, { status: 403 });
    }
  }
  if (!mirrorPreviewEnabled()) return NextResponse.json({ error: "Calendar mirror is disabled." }, { status: 503 });
  if ((input.action === "deliver" || input.approveHash) && !mirrorEnabled()) {
    return NextResponse.json({ error: "Calendar mirror writes are disabled." }, { status: 503 });
  }
  try {
    const result = input.action === "deliver"
      ? await replayHospitalityMirror(input.limit)
      : await hospitalityCatchUp(input.from, input.through, input.approveHash, input.after);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Calendar mirror could not complete the bounded request." }, { status: 409 });
  }
}
