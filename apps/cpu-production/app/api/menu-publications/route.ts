import { NextRequest, NextResponse } from "next/server";
import type { InternalMatrixSignature, PlannedMenuItem } from "../../lib/production-plan";
import { allergenMatrixHtml } from "../../ui/allergen-matrix";

export const dynamic = "force-dynamic";
const menuPlanningBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
async function upstream(request: NextRequest) {
  const response = await fetch(`${menuPlanningBase()}/api/rolling-menu/publications${request.nextUrl.search}`, { cache: "no-store" });
  const body = await response.text();
  return { response, body };
}
export async function GET(request: NextRequest) {
  try {
    const { response, body } = await upstream(request);
    if (!response.ok) return new NextResponse(body, { status: response.status, headers: { "content-type": "application/json" } });
    if (request.nextUrl.searchParams.get("format") !== "matrix") return new NextResponse(body, { headers: { "content-type": "application/json" } });
    const parsed = JSON.parse(body) as { publication?: { days: Array<{ date: string; dayName: string; entries: Array<{ dishName: string; sourceEntryId: string; portions: number; allocations: Array<{ destinationLabel: string; quantity: number }>; allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }>; allergenSignoff: { productionChef?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; headChefSiteManager?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; printedName?: string; signedAt?: string; signatureDataUrl?: string; dayContentHash: string } }> } };
    const publication = parsed.publication;
    const day = publication?.days.find(value => value.date === request.nextUrl.searchParams.get("date")) || publication?.days[0];
    if (!publication || !day) return NextResponse.json({ error: { message: "Published menu day was not found." } }, { status: 404 });
    const menuItems: PlannedMenuItem[] = day.entries.map((entry, index) => ({ id: `published:${entry.sourceEntryId}`, name: entry.dishName, note: "", subItems: [{ id: `published:${entry.sourceEntryId}:${index}`, name: entry.dishName, quantity: entry.portions, allergens: entry.allergens, mayContainNotes: entry.mayContainNotes, note: "", evidenceStatus: "completed" }] }));
    const productionChef = day.allergenSignoff.productionChef || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const headChefSiteManager = day.allergenSignoff.headChefSiteManager || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const signatures: InternalMatrixSignature[] = [
      { role: "production_chef", printedName: productionChef.printedName, signedAt: productionChef.signedAt, actor: productionChef.actor || "menu-planning", attestation: productionChef.attestation || day.allergenSignoff.dayContentHash, ...(productionChef.signatureDataUrl ? { signatureDataUrl: productionChef.signatureDataUrl } : {}) },
      { role: "head_chef_site_manager", printedName: headChefSiteManager.printedName, signedAt: headChefSiteManager.signedAt, actor: headChefSiteManager.actor || "menu-planning", attestation: headChefSiteManager.attestation || day.allergenSignoff.dayContentHash, ...(headChefSiteManager.signatureDataUrl ? { signatureDataUrl: headChefSiteManager.signatureDataUrl } : {}) },
    ];
    const html = allergenMatrixHtml({ clientName: "Delivered-In Menus", destinationLabel: day.entries.flatMap(entry => entry.allocations).map(allocation => allocation.destinationLabel).filter((label, index, labels) => labels.indexOf(label) === index).join(" · "), serviceType: "Delivered-In menu", serviceDate: day.date, requiredBy: `${day.date}T00:00:00` }, menuItems, signatures);
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Published menus could not be loaded." } }, { status: 502 });
  }
}
