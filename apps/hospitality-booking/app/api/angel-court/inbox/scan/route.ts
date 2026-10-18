import { NextResponse } from "next/server";

/** The Angel Court inbox scan is a local-development operation in the Hub (it refuses hosted runtimes), so hosted runtimes never fall back to loopback. */
const hostedRuntime = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const hubUrl = () => process.env.INTEGRATION_HUB_URL || (hostedRuntime() ? undefined : "http://127.0.0.1:3200");
const unavailable = () => NextResponse.json({ error: "The Angel Court inbox scan is not available in this environment." }, { status: 503 });
export async function GET() {
  const hub = hubUrl(); if (!hub) return unavailable();
  try { const response = await fetch(`${hub}/api/angel-court/inbox/scan`, { cache: "no-store" }); return NextResponse.json(await response.json(), { status: response.status }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integration Hub is unavailable." }, { status: 502 }); }
}
export async function POST() {
  const hub = hubUrl(); if (!hub) return unavailable();
  try { const response = await fetch(`${hub}/api/angel-court/inbox/scan`, { method: "POST", cache: "no-store" }); return NextResponse.json(await response.json(), { status: response.status }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integration Hub is unavailable." }, { status: 502 }); }
}
