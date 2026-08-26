import { NextRequest, NextResponse } from "next/server";
import { hubUserFetch } from "@/lib/hub";

export async function GET(request: NextRequest) {
  try {
    const response = await hubUserFetch("/api/hospitality/access", request.headers.get("cookie"));
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 503 }); }
}
