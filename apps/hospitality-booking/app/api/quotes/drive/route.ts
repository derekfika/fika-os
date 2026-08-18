import { NextRequest, NextResponse } from "next/server";
import { saveGoogleDriveHtml } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { name?: string; html?: string; siteKey?: string };
    if (!body.name?.trim() || !body.html?.trim()) return NextResponse.json({ error: { message: "A quote name and document are required." } }, { status: 400 });
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
    const saved = await saveGoogleDriveHtml({ name: body.name.trim(), html: body.html, siteKey: body.siteKey, folderId });
    return NextResponse.json({ saved });
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 502 });
  }
}
