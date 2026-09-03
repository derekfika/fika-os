import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { assertPermission } from "@/lib/authmod";
import { requireActor } from "@/lib/auth";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";

const Body = z.object({
  oplocIds: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
}).strict();

export async function POST(request: NextRequest) {
  try {
    if (!internalProductionRequestAllowed(request)) {
      const actor = await requireActor(request);
      assertPermission(actor, "canonical.view");
    }
    const { oplocIds } = Body.parse(await request.json());
    const { value } = await getOplocReadPackage();
    const packageValue = validateOplocReadPackage(value);
    const labels = new Map(packageValue.oplocs.map(oploc => [oploc.canonicalId, oploc.label] as const));
    const oplocs = [...new Set(oplocIds)].flatMap(requestedId => {
      const canonicalId = packageValue.redirects?.[requestedId] || requestedId;
      const label = labels.get(canonicalId);
      return label ? [{ canonicalId, ...(canonicalId !== requestedId ? { requestedId } : {}), label }] : [];
    });
    return NextResponse.json({ oplocs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
