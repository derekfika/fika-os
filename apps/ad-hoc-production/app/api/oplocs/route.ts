import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const origin = process.env.FIKA_HUB_ORIGIN || "http://localhost:3200";
  try {
    const response = await fetch(`${origin}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
    const body = await response.text();
    return new NextResponse(body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Could not load active OPLOCs." } }, { status: 503 });
  }
}
