import { NextRequest, NextResponse } from "next/server";
import { saveGoogleDrivePdf } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";

/** Server-side Drive adapter used by CPU Production. It is deliberately
 * optional: without OAuth/folder configuration the CPU plan remains usable
 * and retains a local matrix artifact. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; html?: string; pdfBase64?: string; siteKey?: string; weekCommencing?: string };
    if (!body.name?.trim() || !body.html?.trim()) return NextResponse.json({ error: { message: "A matrix file name and document are required." } }, { status: 400 });
    if (!body.pdfBase64?.trim()) return NextResponse.json({ error: { message: "The allergen matrix PDF could not be generated; an HTML file will not be uploaded as a matrix." } }, { status: 422 });
    let folderId: string | undefined;
    if (body.siteKey) {
      try {
        const settingsResponse = await hubUserFetch(`/api/hospitality-bookings?site=${encodeURIComponent(body.siteKey)}`, request.headers.get("cookie"));
        if (settingsResponse.ok) {
          const settings = ((await settingsResponse.json()) as { quoteSettings?: { googleDriveFolderId?: string; googleMatrixFolderId?: string } }).quoteSettings;
          folderId = settings?.googleMatrixFolderId || settings?.googleDriveFolderId;
        }
      } catch { /* environment fallback below */ }
    }
    try {
      const saved = await saveGoogleDrivePdf({ name: body.name.trim(), pdfBase64: body.pdfBase64, siteKey: body.siteKey, folderId, weekCommencing: body.weekCommencing });
      return saved ? NextResponse.json({ saved }) : NextResponse.json({ saved: null, configured: false }, { status: 503 });
    } catch (error) {
      if (/not configured|folder|OAuth|token/i.test((error as Error).message)) return NextResponse.json({ saved: null, configured: false }, { status: 503 });
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 502 });
  }
}
