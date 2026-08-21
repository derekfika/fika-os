import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { materialiseExternalProductionOrder } from "@/lib/production-domain";

const Input = z.object({ sourceDomain: z.enum(["grab-and-go", "menu-planning"]), sourceEntityId: z.string().trim().min(1), sourceVersion: z.number().int().positive(), sourceContentHash: z.string().optional(), sourcePublicationDayId: z.string().optional(), destinationOplocId: z.string().trim().min(1), destinationLabel: z.string().optional(), serviceDate: z.string(), requiredBy: z.string().optional(), serviceWindow: z.object({ startTime: z.string(), endTime: z.string().optional() }).optional(), status: z.enum(["submitted", "published", "amended", "cancelled", "withdrawn"]), lines: z.array(z.object({ sourceLineId: z.string().min(1), canonicalItemId: z.string().optional(), itemName: z.string().min(1), quantity: z.number().nonnegative(), unit: z.string().min(1), workstream: z.enum(["sandwiches", "hospitality", "delivered_in", "grab_and_go", "unassigned"]).optional() })).min(1) }).strict();
function internalAllowed(request: NextRequest) { const configured = process.env.FIKA_INTERNAL_API_TOKEN; return process.env.NODE_ENV !== "production" && !configured || Boolean(configured && request.headers.get("x-fika-internal-token") === configured); }
export async function POST(request: NextRequest) { try { let actor; if (internalAllowed(request)) actor = { uid: "integration-materialiser", name: "Integration Materialiser", role: "integration-admin", synthetic: true } as const; else { actor = await requireActor(request, ["integration-admin", "reviewer"]); assertPermission(actor, "canonical.edit"); } return NextResponse.json(await materialiseExternalProductionOrder(actor, Input.parse(await request.json()))); } catch (error) { return errorResponse(error); } }
