import type { NextRequest } from "next/server";
import { catalogueGateway } from "../../../../lib/catalogue-gateway";
import { studioRouteTrace } from "../../../../lib/data-trace";
import { studioRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = studioRouteTrace("/api/catalogue/version", (request: NextRequest) => {
  const config = studioRuntime();
  return catalogueGateway(config).version(request, request.cookies.get(config.name)?.value);
});
