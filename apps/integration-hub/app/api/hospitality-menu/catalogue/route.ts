import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { saveHospitalityMenuItem } from "@/lib/hospitality-booking-service";
const Command = z.object({ canonicalId: z.string().min(8).optional(), expectedVersion: z.number().int().positive().optional(), name: z.string().trim().min(1), description: z.string().optional(), category: z.string().trim().min(1), dietaryInformation: z.array(z.string()).optional(), allergenInformation: z.array(z.string()).optional(), providerMappings: z.array(z.object({ provider: z.string().min(1), sourceItemId: z.string().min(1), sourceVersion: z.string().optional() })), lifecycleState: z.enum(["active", "archived"]) }).strict();
export async function POST(request: NextRequest) { try { const actor = await requireActor(request, ["integration-admin"]); assertPermission(actor, "canonical.edit"); return NextResponse.json(await saveHospitalityMenuItem(actor, Command.parse(await request.json()))); } catch (error) { return errorResponse(error); } }
