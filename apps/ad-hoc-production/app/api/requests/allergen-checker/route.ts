import { NextRequest, NextResponse } from "next/server";
import { callerFor, isHubError } from "../../../../lib/hub-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const requestId = request.nextUrl.searchParams.get("id")?.trim() || "";
    if (!requestId || requestId.length > 120) return NextResponse.json({ error: { message: "A valid Ad-Hoc request id is required." } }, { status: 422, headers: { "Cache-Control": "no-store" } });
    const { hub } = await callerFor(request);
    if (!hub.allergenPdf) return NextResponse.json({ error: { message: "Signed allergen PDF access is unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const pdf = await hub.allergenPdf(requestId);
    const contentDisposition = pdf.headers.get("content-disposition") || 'inline; filename="signed-allergen-checker.pdf"';
    return new NextResponse(pdf.body, { headers: { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/pdf", "Content-Disposition": contentDisposition, "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const status = isHubError(error) ? error.status : typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The signed allergen PDF could not be opened." } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
