import type { NextRequest } from "next/server";
import { catalogueGateway } from "../../../../lib/catalogue-gateway";
import { studioRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = studioRuntime();
    return catalogueGateway(config).availability(request, request.cookies.get(config.name)?.value);
  } catch {
    return Response.json({ error: { code: "CATALOGUE_UNAVAILABLE", message: "The availability check is unavailable in this environment." } },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
