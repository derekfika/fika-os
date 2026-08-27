import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveGoogleDrivePdf } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";
import { renderPdfLocally } from "@/lib/local-pdf";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; html?: string; pdfBase64?: string; siteKey?: string };
    if (!body.name?.trim() || (!body.html?.trim() && !body.pdfBase64?.trim())) return NextResponse.json({ error: { message: "A quote name and document are required." } }, { status: 400 });
    let folderId: string | undefined;
    if (body.siteKey) {
      try {
        const settingsResponse = await hubUserFetch(`/api/hospitality-bookings?site=${encodeURIComponent(body.siteKey)}`, request.headers.get("cookie"));
        if (settingsResponse.ok) {
          const settings = ((await settingsResponse.json()) as { quoteSettings?: { googleDriveFolderId?: string; googleQuoteFolderId?: string } }).quoteSettings;
          folderId = settings?.googleQuoteFolderId || settings?.googleDriveFolderId;
        }
      } catch { /* environment fallback below */ }
    }
    const pdfBase64 = body.pdfBase64?.trim() || await renderQuotePdf(body.html || "");
    const saved = await saveGoogleDrivePdf({ name: body.name.trim().replace(/\.html?$/i, ".pdf"), pdfBase64, siteKey: body.siteKey, folderId, folderLabel: "Quote" });
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
