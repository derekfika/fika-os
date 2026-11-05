import { NextResponse } from "next/server";
import { z } from "zod";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { mirrorPreviewEnabled } from "../../../../../shared/cpux-calendar/google";
import { deliveredInCatchUp } from "../../../../lib/cpux-mirror/service";

export const runtime = "nodejs";
export const maxDuration = 300;
const command = z.object({ from: z.string(), through: z.string(), approveHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

export async function POST(request: Request) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: "Internal access required." }, { status: 403 });
  if (!mirrorPreviewEnabled()) return NextResponse.json({ error: "Calendar mirror is disabled." }, { status: 503 });
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Calendar catch-up command." }, { status: 400 });
  try {
    return NextResponse.json(await deliveredInCatchUp(parsed.data.from, parsed.data.through, parsed.data.approveHash));
  } catch {
    return NextResponse.json({ error: "Calendar mirror could not complete the bounded request." }, { status: 409 });
  }
}
