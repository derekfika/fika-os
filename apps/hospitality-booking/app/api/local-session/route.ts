import { NextResponse } from "next/server";
import { hubUserFetch, isLocalBridgeEnvironment } from "@/lib/hub";

/** Local-only convenience route. It never contacts a cloud identity provider. */
export async function POST() {
  if (!isLocalBridgeEnvironment()) return NextResponse.json({ error: { message: "Local development sign-in is unavailable in this environment." } }, { status: 403 });
  try {
    const upstream = await hubUserFetch("/api/auth/session", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "integration-admin" }) });
    const body = await upstream.json();
    const response = NextResponse.json(body, { status: upstream.status });
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) response.headers.append("set-cookie", cookie);
    return response;
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 503 });
  }
}
