import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getCataloguePackageBytes } from "@/lib/hospitality-catalogue-package";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";

/**
 * Immutable, content-addressed package bytes (gzip). Served as raw octets with NO Content-Encoding so the browser receives the exact
 * compressed bytes the hash is defined over, verifies them, then decompresses itself.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ hash: string }> }) {
  try {
    await authoriseCatalogueRead(request);
    const { hash } = await context.params;
    if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: { code: "INVALID_HASH", message: "Invalid package hash." } }, { status: 400 });
    const found = await getCataloguePackageBytes(hash);
    if (!found) return NextResponse.json({ error: { code: "PACKAGE_NOT_CURRENT", message: "That package is not current. Re-read the manifest." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(Buffer.from(found.bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable", ETag: `"${hash}"`, "X-Content-Hash": hash } });
  } catch (error) { return errorResponse(error); }
}
