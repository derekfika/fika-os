import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { mirrorPreviewEnabled } from "../../../../../shared/cpux-calendar/google";
import { deliveredInCatchUp } from "../../../../lib/cpux-mirror/service";
import { resolveMenuActor } from "../../../../lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;
const command = z.object({ from: z.string(), through: z.string(), approveHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const proto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  let expected = new URL(request.url).origin;
  if (proto && host && ["http", "https"].includes(proto) && !/[\s\\/]/.test(host)) expected = new URL(`${proto}://${host}`).origin;
  if (!origin || origin !== expected) throw new Error("Same-origin operator request required.");
}

export async function POST(request: NextRequest) {
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Calendar catch-up command." }, { status: 400 });
  const input = parsed.data;
  const internal = internalTokenAllowed(request);
  if (!internal) {
    if (input.approveHash) return NextResponse.json({ error: "Only read-only Calendar diagnostics are available to operator sessions." }, { status: 403 });
    try {
      assertSameOrigin(request);
      const actor = await resolveMenuActor(request);
      if (actor.role !== "integration-admin" || !actor.allOplocs || actor.synthetic) return NextResponse.json({ error: "A real all-site AUTHMOD administrator is required." }, { status: 403 });
      console.info("cpux.calendar.delivered_in.catch_up_diagnostic", { actorId: actor.uid, from: input.from, through: input.through });
    } catch {
      return NextResponse.json({ error: "An authenticated all-site Menu Planning administrator is required." }, { status: 403 });
    }
  }
  if (!mirrorPreviewEnabled()) return NextResponse.json({ error: "Calendar mirror is disabled." }, { status: 503 });
  try {
    return NextResponse.json(await deliveredInCatchUp(input.from, input.through, input.approveHash), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Calendar mirror could not complete the bounded request." }, { status: 409 });
  }
}
