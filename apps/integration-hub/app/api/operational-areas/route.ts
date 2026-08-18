import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import {
  operationalAreasOverview,
  saveOperationalArea,
} from "@/lib/operational-areas-service";

const Command = z
  .object({
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    oplocId: z.string().min(8).max(160),
    name: z.string().trim().min(1).max(160),
    areaTypeId: z.string().min(8).max(160),
    floorLevel: z.number().int(),
    description: z.string().trim().max(2000).optional(),
    lifecycleState: z.enum(["active", "archived"]),
    localOperationalInstructions: z.string().trim().max(4000).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.view");
    const oplocId = z.string().min(8).max(160).parse(req.nextUrl.searchParams.get("oplocId"));
    return NextResponse.json(await operationalAreasOverview(oplocId), noStore());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req, ["integration-admin"]);
    assertPermission(actor, "canonical.edit");
    return NextResponse.json(
      { record: await saveOperationalArea(actor, Command.parse(await req.json())) },
      noStore(),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function noStore() {
  return { headers: { "Cache-Control": "no-store, max-age=0" } };
}
