import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { deleteEquipmentType, equipmentTypeCatalogueOverview, saveOperationalConfiguration } from "@/lib/operational-configuration-service";

const Id = z.string().min(8).max(160);
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), canonicalId: Id.optional(), expectedVersion: z.number().int().positive().optional(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), category: z.string().trim().max(160).optional() }).strict(),
  z.object({ action: z.literal("archive"), canonicalId: Id, expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), category: z.string().trim().max(160).optional() }).strict(),
  z.object({ action: z.literal("restore"), canonicalId: Id, expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), category: z.string().trim().max(160).optional() }).strict(),
  z.object({ action: z.literal("delete"), canonicalId: Id, expectedVersion: z.number().int().positive() }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    return NextResponse.json(await equipmentTypeCatalogueOverview(), noStore());
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin"]);
    assertPermission(actor, "canonical.edit");
    const command = Command.parse(await request.json());
    if (command.action === "delete") return NextResponse.json(await deleteEquipmentType(actor, command.canonicalId, command.expectedVersion), noStore());
    const lifecycleState = command.action === "archive" ? "retired" : "active";
    await saveOperationalConfiguration(actor, { action: "save-equipment-type", canonicalId: command.canonicalId, expectedVersion: command.expectedVersion, name: command.name, ...(command.description ? { description: command.description } : {}), ...(command.category ? { category: command.category } : {}), lifecycleState });
    return NextResponse.json(await equipmentTypeCatalogueOverview(), noStore());
  } catch (error) { return errorResponse(error); }
}

function noStore() { return { headers: { "Cache-Control": "no-store, max-age=0" } }; }
