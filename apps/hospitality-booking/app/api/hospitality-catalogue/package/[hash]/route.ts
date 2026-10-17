import { NextResponse } from "next/server";
import { hubFetch } from "@/lib/hub";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ hash: string }> }) {
  const { hash } = await context.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: { message: "Invalid catalogue package identity." } }, { status: 400 });
  try {
    const response = await hubFetch(`/api/hospitality-catalogue/public-package/${hash}`);
    if (!response.ok) return NextResponse.json({ error: { message: "The Hospitality catalogue package is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(await response.arrayBuffer(), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", ETag: `"${hash}"`, "X-Content-Hash": hash } });
  } catch {
    return NextResponse.json({ error: { message: "The Hospitality catalogue package is temporarily unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
