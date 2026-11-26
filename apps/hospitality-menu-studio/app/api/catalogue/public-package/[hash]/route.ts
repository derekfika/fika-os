import type { NextRequest } from "next/server";
import { publicCatalogueResponse } from "../../../../../lib/catalogue-gateway";
import { studioRouteTrace } from "../../../../../lib/data-trace";
import { studioRuntime } from "../../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ hash: string }> }) {
  const { hash } = await context.params;
  return studioRouteTrace("/api/catalogue/public-package/[hash]", (incoming: NextRequest) => {
    const config = studioRuntime();
    return publicCatalogueResponse(incoming, incoming.cookies.get(config.name)?.value, config, hash);
  })(request);
}
