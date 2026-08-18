import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import {
  operationalConfigurationOverview,
  saveOperationalConfiguration,
} from "@/lib/operational-configuration-service";

const Id = z.string().min(8).max(160);
const Common = { canonicalId: Id.optional(), expectedVersion: z.number().int().positive().optional() };
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-service-definition"), ...Common, serviceName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), lifecycleState: z.enum(["active", "retired"]) }).strict(),
  z.object({ action: z.literal("save-service-arrangement"), ...Common, oplocId: Id, operationalAreaId: Id.optional(), serviceDefinitionId: Id, effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), operationalNotes: z.string().trim().max(2000).optional(), lifecycleState: z.enum(["active", "archived"]) }).strict(),
  z.object({ action: z.literal("save-equipment-type"), ...Common, name: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), category: z.string().trim().max(160).optional(), lifecycleState: z.enum(["active", "retired"]) }).strict(),
  z.object({ action: z.literal("save-equipment-asset"), ...Common, assetName: z.string().trim().min(1).max(160), equipmentTypeId: Id, manufacturer: z.string().trim().max(160).optional(), model: z.string().trim().max(160).optional(), serialNumber: z.string().trim().max(240).optional(), installationDate: z.iso.date().optional(), warrantyExpiry: z.iso.date().optional(), notes: z.string().trim().max(2000).optional(), lifecycleState: z.enum(["active", "retired"]) }).strict(),
  z.object({ action: z.literal("save-equipment-allocation"), ...Common, equipmentAssetId: Id, oplocId: Id, operationalAreaId: Id.optional(), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), operationalNotes: z.string().trim().max(2000).optional(), lifecycleState: z.enum(["active", "archived"]) }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    assertPermission(actor, "canonical.view");
    const oplocId = Id.parse(request.nextUrl.searchParams.get("oplocId"));
    const operationalAreaId = request.nextUrl.searchParams.get("operationalAreaId") || undefined;
    return NextResponse.json(await operationalConfigurationOverview(oplocId, operationalAreaId), noStore());
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin"]);
    assertPermission(actor, "canonical.edit");
    const command = Command.parse(await request.json());
    return NextResponse.json(await saveOperationalConfiguration(actor, command), noStore());
  } catch (error) { return errorResponse(error); }
}

function noStore() { return { headers: { "Cache-Control": "no-store, max-age=0" } }; }
