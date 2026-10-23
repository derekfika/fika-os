import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { getGrabAndGoCataloguePackage } from "../../../../lib/grab-and-go-catalogue-client";
import { runStandingGeneration, SCHEDULER_TEMPLATE_LIMIT } from "../../../../lib/grab-and-go-standing-service";

export const dynamic = "force-dynamic";
/**
 * Bounded, replay-safe standing-order generator. Authenticated by the internal service token only; no browser session
 * can reach it. No Cloud Scheduler job is created by this code: a run happens only when an authorised caller POSTs here.
 */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal generation authority required." } }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as { limit?: unknown; oplocId?: unknown };
    if (!body || typeof body !== "object" || Object.keys(body).some(key => !["limit", "oplocId"].includes(key))) return NextResponse.json({ error: { message: "Only a bounded limit and an optional OPLOC are supported." } }, { status: 422 });
    if (body.limit !== undefined && (!Number.isInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > SCHEDULER_TEMPLATE_LIMIT)) return NextResponse.json({ error: { message: `Limit must be 1–${SCHEDULER_TEMPLATE_LIMIT}.` } }, { status: 422 });
    if (body.oplocId !== undefined && (typeof body.oplocId !== "string" || !body.oplocId.startsWith("oploc:"))) return NextResponse.json({ error: { message: "OPLOC must be a canonical OPLOC id." } }, { status: 422 });
    const catalogue = (await getGrabAndGoCataloguePackage()).catalogue.products;
    return NextResponse.json(await runStandingGeneration({ catalogue, limit: body.limit as number | undefined, oplocId: body.oplocId as string | undefined, trigger: "scheduler" }), { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: { message: "Grab & Go standing-order generation failed." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
