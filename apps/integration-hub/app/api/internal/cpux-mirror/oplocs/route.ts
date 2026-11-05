import { NextResponse } from "next/server";
import { z } from "zod";
import { internalTokenAllowed } from "../../../../../../shared/internal-auth";
import { mirrorPreviewEnabled } from "../../../../../../shared/cpux-calendar/google";
import { resolveMirrorOplocs } from "../../../../../lib/cpux-mirror/oplocs";

export const runtime = "nodejs";
const input = z.object({ ids: z.array(z.string().regex(/^oploc:[a-zA-Z0-9-]+$/).max(100)).min(1).max(64) }).strict();

export async function POST(request: Request) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: "Internal access required." }, { status: 403 });
  if (!mirrorPreviewEnabled()) return NextResponse.json({ error: "Calendar mirror is disabled." }, { status: 503 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A bounded set of OPLOC identities is required." }, { status: 400 });
  try {
    return NextResponse.json({ oplocs: await resolveMirrorOplocs([...new Set(parsed.data.ids)]) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "OPLOC authority is unavailable." }, { status: 503 });
  }
}
