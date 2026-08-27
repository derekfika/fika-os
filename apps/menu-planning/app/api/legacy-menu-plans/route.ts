import { NextRequest, NextResponse } from "next/server";
import { requireMutationActor, resolveMenuActor } from "@/lib/auth";
import { listLegacyMenuPlans, saveLegacyMenuPlan, type LegacyMenuPlan } from "@/lib/legacy-menu-plans";

function errorResponse(error: unknown) { const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu plans are unavailable." } }, { status }); }
export async function GET(request: NextRequest) { try { await resolveMenuActor(request); return NextResponse.json({ plans: listLegacyMenuPlans() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) {
  try {
    const actor = requireMutationActor(await resolveMenuActor(request)); const body = await request.json() as Partial<LegacyMenuPlan>;
    if (!body.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStarting || "") || !Array.isArray(body.weeks)) return NextResponse.json({ error: { message: "Name, week starting date and six-week plan are required." } }, { status: 422 });
    const weekStarting = body.weekStarting as string;
    const plan: LegacyMenuPlan = { id: body.id || `delivered-menu:${weekStarting}`, name: body.name.trim(), weekStarting, weeks: body.weeks as LegacyMenuPlan["weeks"], sourceImports: body.sourceImports || [], updatedAt: new Date().toISOString() };
    return NextResponse.json({ plan: saveLegacyMenuPlan(plan) });
  } catch (error) { return errorResponse(error); }
}
