import { NextRequest, NextResponse } from "next/server";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { canonicalProductionItem, createProductionItemRepository, type ProductionItem } from "../../../lib/production-item-repository";

function errorResponse(error: unknown) { const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "CPU Production items are unavailable." } }, { status }); }

export async function GET(request: NextRequest) {
  try { await requireCpuActor(request); const items = await createProductionItemRepository().list(request.nextUrl.searchParams.get("parentMenuItemKey") || undefined); return NextResponse.json({ productionItems: items, sandwiches: items }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { const actor = await requireCpuActor(request); const item = canonicalProductionItem(await request.json(), actor.uid); await createProductionItemRepository().save(item); return NextResponse.json({ productionItem: item, sandwich: item, productionItems: [item], sandwiches: [item] }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
