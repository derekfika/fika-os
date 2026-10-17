import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";
import { getPublicCataloguePackageBytes } from "@/lib/hospitality-catalogue-package";

/** Immutable public-safe gzip bytes. The bridge token is required only server-to-server. */
export async function GET(request: NextRequest, context: { params: Promise<{ hash: string }> }) {
  try {
    await authoriseCatalogueRead(request);
    const { hash } = await context.params;
    if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: { code: "INVALID_HASH", message: "Invalid package hash." } }, { status: 400 });
    const found = await getPublicCataloguePackageBytes(hash);
    if (!found) return NextResponse.json({ error: { code: "PACKAGE_NOT_FOUND", message: "The immutable package is unavailable." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(Buffer.from(found.bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable", ETag: `"${hash}"`, "X-Content-Hash": hash } });
  } catch (error) { return errorResponse(error); }
}
