import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { assertPermission } from "@/lib/authmod";
import { requireActor } from "@/lib/auth";
import { getActiveCanonicalOplocLabels } from "@/lib/canonical-oplocs";

const Body = z.object({
  oplocIds: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    const { oplocIds } = Body.parse(await request.json());
    const labels = await getActiveCanonicalOplocLabels([...new Set(oplocIds)]);
    return NextResponse.json({ oplocs: [...labels].map(([canonicalId, label]) => ({ canonicalId, label })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
