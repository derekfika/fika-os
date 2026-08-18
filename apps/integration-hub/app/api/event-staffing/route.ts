import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { eventStaffingOverview, eventStaffingSuggestions, saveEventStaffing, type EventStaffingCommand } from "@/lib/event-staffing-service";

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-operational-team"), canonicalId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), teamName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), lifecycleState: z.enum(["active", "archived"]) }).strict(),
  z.object({ action: z.literal("save-team-membership"), canonicalId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), legendId: z.string().min(8), teamId: z.string().min(8), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), notes: z.string().trim().max(1000).optional(), lifecycleState: z.enum(["active", "archived"]) }).strict(),
  z.object({ action: z.literal("save-event-role"), canonicalId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), roleName: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).optional(), lifecycleState: z.enum(["active", "retired"]) }).strict(),
  z.object({ action: z.literal("save-event-staffing-preference"), canonicalId: z.string().optional(), expectedVersion: z.number().int().positive().optional(), legendId: z.string().min(8), eventRoleId: z.string().min(8), eligibility: z.enum(["primary", "secondary", "fallback"]), suggestionRank: z.number().int().positive(), effectiveFrom: z.iso.date(), effectiveTo: z.iso.date().optional(), notes: z.string().trim().max(1000).optional(), lifecycleState: z.enum(["active", "archived"]) }).strict(),
]);
export async function GET(req: NextRequest) { try { const actor = await requireActor(req); assertPermission(actor, "canonical.view"); const role = req.nextUrl.searchParams.get("eventRole"); if (!role) return NextResponse.json(await eventStaffingOverview(), noStore()); const overview = await eventStaffingOverview(); return NextResponse.json({ suggestions: await eventStaffingSuggestions(role), activeLegends: overview.legends.filter(legend => !legend.terminated) }, noStore()); } catch (error) { return errorResponse(error); } }
export async function POST(req: NextRequest) { try { const actor = await requireActor(req, ["integration-admin"]); return NextResponse.json(await saveEventStaffing(actor, Command.parse(await req.json()) as EventStaffingCommand), noStore()); } catch (error) { return errorResponse(error); } }
function noStore() { return { headers: { "Cache-Control": "no-store, max-age=0" } }; }
