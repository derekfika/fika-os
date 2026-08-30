import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { listCacheDataset } from "@/lib/integration-cache-server";
import { CACHE_DATASETS, type CacheDataset } from "@/lib/integration-cache-shared";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    const dataset = request.nextUrl.searchParams.get("dataset") as CacheDataset;
    if (!(CACHE_DATASETS as readonly string[]).includes(dataset)) return NextResponse.json({ error: { message: "Unknown cache dataset." } }, { status: 400 });
    return NextResponse.json(await listCacheDataset(actor, dataset), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
