import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveGoogleDrivePdf } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";
import { renderPdfLocally } from "@/lib/local-pdf";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; html?: string; pdfBase64?: string; canonicalId?: string };
    if (!body.name?.trim() || (!body.html?.trim() && !body.pdfBase64?.trim())) return NextResponse.json({ error: { message: "A quote name and document are required." } }, { status: 400 });
    if (!body.canonicalId) return NextResponse.json({ error: { message: "A canonical Booking is required." } }, { status: 400 });
    const bookingResponse = await hubUserFetch(`/api/hospitality-bookings?canonicalId=${encodeURIComponent(body.canonicalId)}`, request.headers.get("cookie"));
    const bookingBody = await bookingResponse.json() as { booking?: { service?: { oplocId?: string; portalSiteId?: string } }; quoteSettings?: { googleDriveFolderId?: string; googleQuoteFolderId?: string } ; error?: { message?: string } };
    if (!bookingResponse.ok || !bookingBody.booking?.service?.oplocId) return NextResponse.json({ error: { message: bookingBody.error?.message || "The canonical Booking could not be loaded." } }, { status: bookingResponse.status || 403 });
    const pdfBase64 = body.pdfBase64?.trim() || await renderQuotePdf(body.html || "");
    const saved = await saveGoogleDrivePdf({ name: body.name.trim().replace(/\.html?$/i, ".pdf"), pdfBase64, owner: { type: "oploc-workspace", oplocId: bookingBody.booking.service.oplocId }, folderId: bookingBody.quoteSettings?.googleQuoteFolderId || bookingBody.quoteSettings?.googleDriveFolderId, folderLabel: "Quote" });
    if (!saved) return NextResponse.json({ error: { message: "The quote PDF could not be saved because no quote Drive folder is configured." } }, { status: 502 });
    return NextResponse.json({ saved });
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 502 });
  }
}
async function renderQuotePdf(html: string) {
  const outputPath = path.join(os.tmpdir(), `fika-quote-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await renderPdfLocally(html, outputPath);
    return (await fs.readFile(outputPath)).toString("base64");
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}
