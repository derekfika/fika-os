import { NextRequest, NextResponse } from "next/server";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { menuPlanningJson } from "../../../lib/menu-planning-http-client";

type MenuPlan = { id: string; name: string; weekStarting: string; weeks: Array<{ weekStarting: string; days: Array<{ date: string; day: string; entries: Array<Record<string, unknown>> }> }>; sourceImports?: Array<{ fileName: string; importedAt: string; candidateCount: number; sheets: string[] }>; updatedAt: string };
const isMenuPlansResponse = (value: unknown): value is { plans: MenuPlan[] } => Boolean(value && typeof value === "object" && Array.isArray((value as { plans?: unknown }).plans));
const isMenuPlanResponse = (value: unknown): value is { plan: MenuPlan } => Boolean(value && typeof value === "object" && (value as { plan?: unknown }).plan);
function errorResponse(error: unknown) { const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu Planning plans are unavailable." } }, { status }); }
export async function GET(request: NextRequest) { try { await requireCpuActor(request); return NextResponse.json(await menuPlanningJson(request, "/api/legacy-menu-plans", isMenuPlansResponse), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
export async function POST(request: NextRequest) { try { await requireCpuActor(request); const body = await request.clone().text(); return NextResponse.json(await menuPlanningJson(request, "/api/legacy-menu-plans", isMenuPlanResponse, { method: "POST", headers: { "content-type": "application/json" }, body })); } catch (error) { return errorResponse(error); } }
