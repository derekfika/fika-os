import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { readCacheManifests } from "@/lib/integration-cache-server";
import { CACHE_DATASETS, type CacheDataset } from "@/lib/integration-cache-shared";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    const requested = request.nextUrl.searchParams.getAll("dataset").filter((value): value is CacheDataset => (CACHE_DATASETS as readonly string[]).includes(value));
    return NextResponse.json({ manifests: await readCacheManifests(requested.length ? requested : [...CACHE_DATASETS]) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.cache.manifests.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
