import { NextResponse } from "next/server";
import { hubFetch } from "@/lib/hub";

export const dynamic = "force-dynamic";
const PUBLIC_MANIFEST_FIELDS = ["dataset", "packageVersion", "schemaVersion", "contractVersion", "objectName", "compression", "contentHash", "compressedSize", "uncompressedSize", "recordCount", "generatedAt"] as const;

/** Public same-origin cache head. The bridge credential stays server-side; Hub reads only the published package manifest. */
export async function GET() {
  try {
    const response = await hubFetch("/api/hospitality-catalogue/public-package");
    if (!response.ok) return NextResponse.json({ error: { message: "The Hospitality catalogue is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const body = await response.json() as Record<string, unknown>;
    const manifest = Object.fromEntries(PUBLIC_MANIFEST_FIELDS.map(key => [key, body[key]]));
    if (manifest.dataset !== "hospitality-booking/catalogue" || typeof manifest.contentHash !== "string") return NextResponse.json({ error: { message: "The Hospitality catalogue manifest is invalid." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(manifest, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300", ETag: `"${manifest.contentHash}"` } });
  } catch {
    return NextResponse.json({ error: { message: "The Hospitality catalogue is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
