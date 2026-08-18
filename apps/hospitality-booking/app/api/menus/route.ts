import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hubUserFetch } from "@/lib/hub";
import type { CanonicalBooking } from "../../../../integration-hub/lib/hospitality-booking-service";
import type { MenuOutput } from "@/lib/mnk-menu-output";
import { menuBookingContext, menuFileName } from "@/lib/mnk-menu-output";
import { createGoogleMenu } from "@/lib/google-menu";

const storePath = path.join(process.cwd(), "local-data", "hospitality-booking", "menu-outputs.json");
async function readOutputs(): Promise<MenuOutput[]> { try { return JSON.parse(await fs.readFile(storePath, "utf8")) as MenuOutput[]; } catch { return []; } }
async function writeOutputs(outputs: MenuOutput[]) { await fs.mkdir(path.dirname(storePath), { recursive: true }); await fs.writeFile(storePath, JSON.stringify(outputs, null, 2), "utf8"); }
function cpuBase() { return (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, ""); }

export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("bookingId");
  const outputs = await readOutputs();
  return NextResponse.json({ outputs: bookingId ? outputs.filter(output => output.bookingId === bookingId) : outputs });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { bookingId?: string; productionOrderId?: string; actor?: string; driveFolderId?: string; menuTemplateId?: string };
    if (!body.bookingId) return NextResponse.json({ error: { message: "A Booking is required." } }, { status: 400 });
    const bookingResponse = await hubUserFetch("/api/hospitality-bookings", request.headers.get("cookie"));
    const bookingBody = await bookingResponse.json() as { bookings?: CanonicalBooking[]; error?: { message?: string } };
    if (!bookingResponse.ok) throw Error(bookingBody.error?.message || "The canonical Booking could not be loaded.");
    const booking = bookingBody.bookings?.find(item => item.canonicalId === body.bookingId);
    if (!booking) return NextResponse.json({ error: { message: "The Booking could not be found." } }, { status: 404 });
    const candidates = [...new Set([body.productionOrderId, `production-order:v1:${body.bookingId}`, `production-order:${body.bookingId}`, body.bookingId].filter(Boolean))] as string[];
    let cpuBody: { plan?: { id: string; status: string; updatedAt: string; menuItems: Array<{ name: string; subItems: Array<{ name: string; allergens: Record<string, string> }> }> }; error?: { message?: string } } = {};
    for (const cpuOrderId of candidates) {
      const cpuResponse = await fetch(`${cpuBase()}/api/production-plan?orderId=${encodeURIComponent(cpuOrderId)}`, { cache: "no-store" });
      const candidate = await cpuResponse.json() as typeof cpuBody;
      if (candidate.plan && candidate.plan.status === "planned") { cpuBody = candidate; break; }
      if (!cpuBody.plan) cpuBody = candidate;
    }
    if (!cpuBody.plan) throw Error(cpuBody.error?.message || "The CPU plan could not be loaded.");
    if (cpuBody.plan.status !== "planned") return NextResponse.json({ error: { message: "The production team must mark the CPU plan Planned before the menu planning team can generate a menu." } }, { status: 409 });
    const generatedAt = new Date().toISOString();
    const bookingContext = menuBookingContext(booking);
    const output: MenuOutput = { id: `menu-output:${body.bookingId}:${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`, fileName: menuFileName(bookingContext), bookingId: body.bookingId, planId: cpuBody.plan.id, planUpdatedAt: cpuBody.plan.updatedAt, generatedAt, generatedBy: body.actor || "menu-planning", templateVersion: "mnk-hospitality-menu-v1", booking: bookingContext, items: cpuBody.plan.menuItems.flatMap(menuItem => menuItem.subItems.filter(subItem => subItem.name.trim()).map(subItem => ({ menuItem: menuItem.name, name: subItem.name, allergens: Object.entries(subItem.allergens).filter(([, state]) => state === "contains").map(([key]) => key), mayContain: Object.entries(subItem.allergens).filter(([, state]) => state === "may_contain").map(([key]) => key) }))) };
    let persisted = output;
    try {
      const google = await createGoogleMenu(output, booking.service.portalSiteId || "mnk", { folderId: body.driveFolderId, templateId: body.menuTemplateId });
      if (google) persisted = { ...output, google };
    } catch (error) {
      return NextResponse.json({ error: { message: `Menu was not created in Google Slides: ${(error as Error).message}` } }, { status: 502 });
    }
    const outputs = await readOutputs();
    await writeOutputs([...outputs, persisted]);
    return NextResponse.json({ output: persisted });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 400 }); }
}
