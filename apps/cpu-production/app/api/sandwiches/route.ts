import { NextRequest, NextResponse } from "next/server";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { menuPlanningJson } from "../../../lib/menu-planning-http-client";

type ProductionItem = { id: string; title: string; allergens: Record<string, string>; mayContainNotes?: string; parentMenuItemKey?: string; itemType?: string; category?: string };
type SandwichResponse = { sandwiches?: ProductionItem[]; productionItems?: ProductionItem[]; sandwich?: ProductionItem; productionItem?: ProductionItem };
const isSandwichResponse = (value: unknown): value is SandwichResponse => Boolean(value && typeof value === "object" && (Array.isArray((value as SandwichResponse).sandwiches) || Array.isArray((value as SandwichResponse).productionItems) || (value as SandwichResponse).sandwich || (value as SandwichResponse).productionItem));
function errorResponse(error: unknown) { const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu Planning production items are unavailable." } }, { status }); }

export async function GET(request: NextRequest) {
  try { await requireCpuActor(request); const response = await menuPlanningJson(request, `/api/sandwiches${request.nextUrl.search}`, isSandwichResponse); const items = response.productionItems || response.sandwiches || []; return NextResponse.json({ ...response, productionItems: items, sandwiches: items }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { await requireCpuActor(request); const body = await request.clone().text(); const response = await menuPlanningJson(request, "/api/sandwiches", isSandwichResponse, { method: "POST", headers: { "content-type": "application/json" }, body }); const items = response.productionItems || response.sandwiches || []; return NextResponse.json({ ...response, productionItems: items, sandwiches: items }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
