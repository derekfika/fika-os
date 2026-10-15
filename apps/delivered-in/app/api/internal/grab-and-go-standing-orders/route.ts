import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { getGrabAndGoCataloguePackage } from "@/lib/grab-and-go-catalogue-client";
import { generateDueStandingOrders } from "@/lib/grab-and-go-standing-service";
import { deliverGrabHandoff, grabHandoffEvent, grabHandoffId } from "../../../../lib/grab-and-go-handoff";
import { forwardProductionMaterialisation } from "../../../../lib/production-client";

export const dynamic = "force-dynamic";
/** Daily Europe/London scheduler target. Idempotent: running it again creates nothing new. */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: { message: "Internal scheduler authority required." } }, { status: 403 });
  try {
    const hosted = ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
    const products = (await getGrabAndGoCataloguePackage()).catalogue.products;
    const result = await generateDueStandingOrders({ products, deliver: order => hosted ? deliverGrabHandoff(grabHandoffId(order)) : forwardProductionMaterialisation(grabHandoffEvent(order).payload, { allowPending: true }) });
    return NextResponse.json({ evaluated: result.evaluated, created: result.created, outcomes: result.outcomes.map(({ order: _order, ...outcome }) => outcome) });
  } catch (error) { return NextResponse.json({ error: { message: "Standing-order generation failed." } }, { status: Number((error as { status?: number }).status) || 503 }); }
}
