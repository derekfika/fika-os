import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { saveOperationalConfiguration } from "@/lib/operational-configuration-service";
import { deleteUnusedServiceDefinition, serviceDefinitionCatalogueOverview } from "@/lib/service-catalogue-service";
import { getServiceDefinitionsReadPackage, validateServiceDefinitionsReadPackage } from "@/lib/service-definitions-read-package";

const Id = z.string().min(8).max(160);
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), canonicalId: Id.optional(), expectedVersion: z.number().int().positive().optional(), serviceName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.enum(["archive", "restore"]), canonicalId: Id, expectedVersion: z.number().int().positive(), serviceName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal("delete"), canonicalId: Id, expectedVersion: z.number().int().positive() }).strict(),
]);
export async function GET(request: NextRequest) { try { const actor = await requireActor(request); assertPermission(actor, "canonical.view"); const { value } = await getServiceDefinitionsReadPackage(); return NextResponse.json(validateServiceDefinitionsReadPackage(value), noStore()); } catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) { try { const actor = await requireActor(request, ["integration-admin"]); assertPermission(actor, "canonical.edit"); const command = Command.parse(await request.json()); if (command.action === "delete") return NextResponse.json(await deleteUnusedServiceDefinition(actor, command.canonicalId, command.expectedVersion), noStore()); await saveOperationalConfiguration(actor, { action: "save-service-definition", canonicalId: command.canonicalId, expectedVersion: command.expectedVersion, serviceName: command.serviceName, ...(command.description ? { description: command.description } : {}), lifecycleState: command.action === "archive" ? "retired" : "active" }); return NextResponse.json(await serviceDefinitionCatalogueOverview(), noStore()); } catch (error) { return errorResponse(error); } }
function noStore() { return { headers: { "Cache-Control": "no-store, max-age=0" } }; }
