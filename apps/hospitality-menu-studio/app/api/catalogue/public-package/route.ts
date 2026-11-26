import type { NextRequest } from "next/server";
import { publicCatalogueResponse } from "../../../../lib/catalogue-gateway";
import { studioRouteTrace } from "../../../../lib/data-trace";
import { studioRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = studioRouteTrace("/api/catalogue/public-package", (request: NextRequest) => {
  const config = studioRuntime();
  return publicCatalogueResponse(request, request.cookies.get(config.name)?.value, config);
});
