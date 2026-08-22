import { NextRequest, NextResponse } from "next/server";
import { saveGoogleDrivePdf } from "@/lib/google-menu";
import { hubUserFetch } from "@/lib/hub";

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
    const pdfBase64 = body.pdfBase64?.trim() || htmlToPdfBase64(body.html || "");
    const saved = await saveGoogleDrivePdf({ name: body.name.trim().replace(/\.html?$/i, ".pdf"), pdfBase64, siteKey: body.siteKey, folderId, folderLabel: "Quote" });
    return NextResponse.json({ saved });
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 502 });
  }
}

// Small dependency-free PDF writer for the generated quote snapshot. The quote
// remains rendered in the dashboard for viewing; Drive receives a real PDF.
function htmlToPdfBase64(html: string) {
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const lines = text.match(/.{1,92}(?:\s|$)/g)?.map(line => line.trim()).filter(Boolean) || ["FIKA Hospitality Quote"];
  const stream = ["BT", "/F1 10 Tf", "50 780 Td", ...lines.slice(0, 52).flatMap((line, index) => [index ? "0 -14 Td" : "", `(${line.replace(/[\\()]/g, "\\$&")}) Tj`]), "ET"].filter(Boolean).join("\n");
  const objects = [`1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj`, `2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj`, `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj`, `4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj`, `5 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream endobj`];
  let pdf = "%PDF-1.4\n"; const offsets = [0]; for (const object of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += `${object}\n`; } const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}
