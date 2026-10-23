import { NextRequest, NextResponse } from "next/server";
import { canonicalOplocId } from "@fika/server-shared/governed-oplocs";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { getGrabAndGoCataloguePackage } from "@/lib/grab-and-go-catalogue-client";
import { mutateStandingOrder, standingOverview } from "@/lib/grab-and-go-standing-service";
import { assertAuthorisedOploc } from "@/lib/projection";
import { deliveredInErrorBody, resolveAccess } from "@/lib/server";

export const dynamic = "force-dynamic";
const ACTIONS = ["save", "populate-slot", "activate", "pause", "resume", "terminate", "cancel-upcoming", "generate"] as const;
const BODY_KEYS = new Set(["oplocId", "action", "expectedVersion", "slots", "note", "deliveryDate"]);
const noStore = { "Cache-Control": "no-store, max-age=0" };

async function authorisedSite(request: NextRequest, requested?: string) {
  const resolved = await resolveAccess(request, "grab-and-go"); const selected = requested || (resolved.access.oplocIds.length === 1 ? resolved.access.oplocIds[0] : undefined);
  if (!selected) throw Object.assign(new Error("Select an OPLOC with Grab & Go enabled first."), { status: 422 });
  assertAuthorisedOploc(resolved.access, selected);
  // Templates are owned by the canonical OPLOC; a historical alias resolves through the Hub-authorised id.
  return { oplocId: canonicalOplocId(selected)!, access: resolved.access };
}

async function handleGet(request: NextRequest) {
  try {
    const { oplocId } = await authorisedSite(request, request.nextUrl.searchParams.get("oplocId") || undefined);
    const catalogue = (await getGrabAndGoCataloguePackage()).catalogue.products;
    return NextResponse.json(await standingOverview(oplocId, catalogue), { headers: noStore });
  } catch (error) { return NextResponse.json(deliveredInErrorBody(error, "Standing orders could not be loaded."), { status: Number((error as { status?: number }).status) || 502 }); }
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Object.keys(body).some(key => !BODY_KEYS.has(key))) return NextResponse.json({ error: { message: "Unsupported standing-order request." } }, { status: 422 });
    const action = body.action as typeof ACTIONS[number];
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: { message: "A valid standing-order action is required." } }, { status: 422 });
    if (body.expectedVersion !== undefined && !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: { message: "Current version must be a whole number." } }, { status: 422 });
    if (body.deliveryDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.deliveryDate))) return NextResponse.json({ error: { message: "Delivery date must be YYYY-MM-DD." } }, { status: 422 });
    if (["generate", "cancel-upcoming"].includes(action) && !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: { message: "The current standing-order version is required." } }, { status: 422 });
    const { oplocId, access } = await authorisedSite(request, typeof body.oplocId === "string" ? body.oplocId : undefined);
    const catalogue = (await getGrabAndGoCataloguePackage()).catalogue.products;
    const result = await mutateStandingOrder({ action, oplocId, actor: access.email, expectedVersion: body.expectedVersion as number | undefined, slots: body.slots, note: typeof body.note === "string" ? body.note : undefined, deliveryDate: typeof body.deliveryDate === "string" ? body.deliveryDate : undefined }, catalogue);
    return NextResponse.json(result, { status: result.version && result.version.version === 1 ? 201 : 200, headers: noStore });
  } catch (error) { return NextResponse.json(deliveredInErrorBody(error, "The standing order could not be saved."), { status: Number((error as { status?: number }).status) || 502 }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "delivered-in", action: "delivered-in.grab-and-go.standing.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
