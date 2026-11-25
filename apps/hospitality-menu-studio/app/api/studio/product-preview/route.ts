import type { NextRequest } from "next/server";
import { z } from "zod";
import { dateSchema, idSchema } from "../../../../../shared/hospitality-menu-studio-content";
import { assertStudioRequestHost, authoriseStudio, studioSessionCookie } from "../../../../lib/auth";
import { catalogueUnavailable, readStudioCatalogue } from "../../../../lib/catalogue";
import { productMenuPreviewOffering } from "../../../../lib/product-menu-preview";
import { StudioProblem } from "../../../../lib/problem";
import { studioRuntime } from "../../../../lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.strictObject({ itemId: idSchema, siteId: idSchema, eventDate: dateSchema });
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const config = studioRuntime();
    assertStudioRequestHost(config, request.headers.get("host"));
    const cookie = request.cookies.get(config.name)?.value;
    await authoriseStudio(cookie, config);
    const params = request.nextUrl.searchParams;
    if ([...params].length !== 3) throw new StudioProblem(422, "INVALID_REQUEST", "Choose one product, site and date.");
    const { itemId, siteId, eventDate } = query.parse(Object.fromEntries(params));
    if (!cookie || config.fixture) throw catalogueUnavailable();
    const catalogue = await readStudioCatalogue(config.hub, studioSessionCookie(config, cookie));
    return Response.json(productMenuPreviewOffering(catalogue.catalogue, itemId, siteId, eventDate), { headers });
  } catch (error) {
    const problem = error instanceof StudioProblem ? error
      : error instanceof z.ZodError ? new StudioProblem(422, "INVALID_REQUEST", "Choose one product, site and date.")
      : new StudioProblem(503, "PRODUCT_PREVIEW_UNAVAILABLE", "The current price and site rules could not be verified.");
    return Response.json({ code: problem.code, error: problem.message }, { status: problem.status, headers });
  }
}
