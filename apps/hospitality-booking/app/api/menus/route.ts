import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hubUserFetch } from "@/lib/hub";
import type { CanonicalBooking } from "@/lib/canonical-types";
import type { MenuOutput } from "@/lib/mnk-menu-output";
import { createGoogleMenu } from "@/lib/google-menu";
import { hospitalityMenuFromBooking } from "@/lib/menu-adapter";
import { MenuArtifactError, menuArtifactFileName } from "@fika/server-shared/menu-artifact";
import { cpuBodyErrorMessage, cpuNotFound, fetchCpuProductionPlan, readCpuJson } from "@/lib/cpu-production";

const storePath = path.join(process.cwd(), "local-data", "hospitality-booking", "menu-outputs.json");
async function readOutputs(): Promise<MenuOutput[]> { try { return JSON.parse(await fs.readFile(storePath, "utf8")) as MenuOutput[]; } catch { return []; } }
async function writeOutputs(outputs: MenuOutput[]) { await fs.mkdir(path.dirname(storePath), { recursive: true }); await fs.writeFile(storePath, JSON.stringify(outputs, null, 2), "utf8"); }
function productionOrderCandidates(bookingId: string, productionOrderId?: string, sourceBookingId?: string) {
  return [...new Set([productionOrderId, `production-order:v1:${bookingId}`, `production-order:${bookingId}`, bookingId, sourceBookingId].filter(Boolean))] as string[];
}
function planReadiness(plan?: { status: string; menuItems?: Array<{ name?: string; subItems?: Array<{ name?: string; allergens?: Record<string, string> }> }> }) {
  if (!plan) return { available: false, reason: "The CPU plan is not available yet." };
  if (plan.status !== "planned") return { available: false, reason: "The CPU plan must be marked Planned first." };
  const subItems = (plan.menuItems || []).flatMap((item) => item.subItems || []).filter((item) => item.name?.trim());
  if (!subItems.length) return { available: false, reason: "Menu items are not available yet." };
  if (subItems.some((item) => !item.allergens || !Object.keys(item.allergens).length)) return { available: false, reason: "Allergen information is not complete yet." };
  return { available: true, reason: "Menu items and allergen information are ready." };
}

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const outputs = await readOutputs();
  if (!bookingId || request.nextUrl.searchParams.get("readiness") !== "1") return NextResponse.json({ outputs: bookingId ? outputs.filter(output => output.bookingId === bookingId) : outputs });
  const bookingResponse = await hubUserFetch("/api/hospitality-bookings", request.headers.get("cookie"));
  const bookingBody = await bookingResponse.json() as { bookings?: CanonicalBooking[]; error?: { message?: string } };
  if (!bookingResponse.ok) return NextResponse.json({ readiness: { available: false, reason: bookingBody.error?.message || "The Booking could not be loaded." } }, { status: bookingResponse.status });
  const booking = bookingBody.bookings?.find((item) => item.canonicalId === bookingId);
  if (!booking) return NextResponse.json({ readiness: { available: false, reason: "The Booking could not be found." } }, { status: 404 });
  const candidates = productionOrderCandidates(booking.canonicalId, request.nextUrl.searchParams.get("productionOrderId") || undefined, booking.source.sourceBookingId);
  let plan: { id: string; status: string; updatedAt: string; menuItems: Array<{ name: string; subItems: Array<{ name: string; allergens: Record<string, string> }> }> } | undefined;
  for (const candidate of candidates) {
    const response = await fetchCpuProductionPlan(request, candidate);
    const body = await readCpuJson(response) as { plan?: typeof plan; error?: { message?: string; code?: string } };
    if (!response.ok) {
      if (cpuNotFound(response, body)) continue;
      return NextResponse.json({ readiness: { available: false, reason: cpuBodyErrorMessage(body, response.status) } }, { status: response.status || 502 });
    }
    if (body.plan && body.plan.status === "planned") { plan = body.plan; break; }
    if (body.plan) { plan = body.plan; break; }
  }
  return NextResponse.json({ readiness: { ...planReadiness(plan), planId: plan?.id, planUpdatedAt: plan?.updatedAt } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { bookingId?: string; productionOrderId?: string; actor?: string };
    if (!body.bookingId) return NextResponse.json({ error: { message: "A Booking is required." } }, { status: 400 });
    const bookingResponse = await hubUserFetch(`/api/hospitality-bookings?canonicalId=${encodeURIComponent(body.bookingId)}`, request.headers.get("cookie"));
    const bookingBody = await bookingResponse.json() as { booking?: CanonicalBooking; quoteSettings?: { googleMenuFolderId?: string; googleMenuTemplateId?: string }; error?: { message?: string } };
    if (!bookingResponse.ok) throw Error(bookingBody.error?.message || "The canonical Booking could not be loaded.");
    const booking = bookingBody.booking;
    if (!booking) return NextResponse.json({ error: { message: "The Booking could not be found." } }, { status: 404 });
    if (!booking.service.oplocId) return NextResponse.json({ error: { message: "The Booking has no canonical OPLOC." } }, { status: 409 });
    // Prefer the shared canonical production-order ID, while retaining the
    // original portal reference as a compatibility fallback for this booking.
    const candidates = productionOrderCandidates(body.bookingId, body.productionOrderId, booking.source.sourceBookingId);
    let cpuBody: { plan?: { id: string; status: string; updatedAt: string; menuItems: Array<{ name: string; subItems: Array<{ name: string; allergens: Record<string, string> }> }> }; error?: { message?: string } } = {};
    for (const cpuOrderId of candidates) {
      const cpuResponse = await fetchCpuProductionPlan(request, cpuOrderId);
      const candidate = await readCpuJson(cpuResponse) as typeof cpuBody;
      if (!cpuResponse.ok) {
        if (cpuNotFound(cpuResponse, candidate)) continue;
        return NextResponse.json({ error: { message: cpuBodyErrorMessage(candidate, cpuResponse.status) } }, { status: cpuResponse.status || 502 });
      }
      if (candidate.plan && candidate.plan.status === "planned") { cpuBody = candidate; break; }
      if (candidate.plan) { cpuBody = candidate; break; }
    }
    if (!cpuBody.plan) throw Error(cpuBody.error?.message || "The CPU plan could not be loaded.");
    const readiness = planReadiness(cpuBody.plan);
    if (!readiness.available) return NextResponse.json({ error: { message: readiness.reason } }, { status: 409 });
    // Normalize first: this is where cancelled/superseded/unplanned bookings and
    // unrecorded allergens are refused, before any Google call is made.
    let menu;
    try { menu = hospitalityMenuFromBooking(booking, cpuBody.plan); }
    catch (error) { if (error instanceof MenuArtifactError) return NextResponse.json({ error: { message: error.message, code: error.code } }, { status: error.status }); throw error; }
    const generatedAt = new Date().toISOString();
    const output: MenuOutput = {
      id: `menu-output:${body.bookingId}:${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`, fileName: menuArtifactFileName(menu), bookingId: body.bookingId,
      planId: cpuBody.plan.id, planUpdatedAt: cpuBody.plan.updatedAt, generatedAt, generatedBy: body.actor || "menu-planning", templateVersion: "mnk-hospitality-menu-v2",
      booking: { companyName: menu.source.clientName || "", destination: menu.siteLabel, date: menu.serviceDate, time: menu.serviceTime || "", guestCount: booking.service.guestCount },
      items: menu.sections.flatMap(section => section.items).map(item => ({ menuItem: item.id.split(":")[0], name: item.name, allergens: item.contains, mayContain: item.mayContain })),
    };
    let persisted = output;
    try {
      const published = await createGoogleMenu(menu, { type: "oploc-workspace", oplocId: booking.service.oplocId }, { folderId: bookingBody.quoteSettings?.googleMenuFolderId, templateId: bookingBody.quoteSettings?.googleMenuTemplateId });
      persisted = { ...output, fileName: published.fileName, google: { fileId: published.fileId, presentationUrl: published.presentationUrl, driveUrl: published.driveUrl }, artifactKey: published.artifactKey, ...(published.retiredFileIds.length ? { retiredFileIds: published.retiredFileIds } : {}) };
    } catch (error) {
      if (error instanceof MenuArtifactError) return NextResponse.json({ error: { message: error.message, code: error.code } }, { status: error.status });
      return NextResponse.json({ error: { message: `Menu was not created in Google Slides: ${(error as Error).message}` } }, { status: 502 });
    }
    const outputs = await readOutputs();
    // A booking has one current menu output. Regeneration replaces the prior
    // revision so the dashboard and local persistence cannot drift into a
    // list of stale duplicate menus.
    await writeOutputs([...outputs.filter(item => item.bookingId !== persisted.bookingId), persisted]);
    return NextResponse.json({ output: persisted });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 400 }); }
}
