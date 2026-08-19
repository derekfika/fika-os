import { NextRequest, NextResponse } from "next/server";
import { getMenuPublication, listMenuPublications } from "@/lib/menu-publication";

export async function GET(request: NextRequest) {
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  if (publicationId) {
    const publication = getMenuPublication(publicationId);
    if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
    return NextResponse.json({ publication });
  }
  return NextResponse.json({ publications: listMenuPublications() });
}
