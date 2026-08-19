import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { reconcileCentralFulfilment } from "@/lib/fulfilment-projection";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request); assertPermission(actor, "canonical.view");
    const body = await request.json() as { expected?: unknown[] };
    return NextResponse.json({ issues: await reconcileCentralFulfilment((body.expected || []) as never[]) });
  } catch (error) { return errorResponse(error); }
}
