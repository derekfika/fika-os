import { NextResponse } from "next/server";
import { getCompiledPublicationSnapshot } from "@/lib/menu-publication";

export async function GET(request: Request, { params }: { params: Promise<{ publicationId: string }> }) {
  try {
    const { publicationId } = await params;
    const versionValue = new URL(request.url).searchParams.get("version");
    const version = versionValue ? Number(versionValue) : undefined;
    if (versionValue && (!Number.isInteger(version) || version! < 1)) return NextResponse.json({ error: { message: "Publication snapshot version must be a positive integer." } }, { status: 400 });
    const snapshot = await getCompiledPublicationSnapshot(decodeURIComponent(publicationId), version);
    return snapshot ? NextResponse.json({ snapshot }) : NextResponse.json({ error: { message: "Publication snapshot was not found." } }, { status: 404 });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Publication snapshot could not be loaded." } }, { status: 500 }); }
}
