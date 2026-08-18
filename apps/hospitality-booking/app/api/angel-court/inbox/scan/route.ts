import { NextResponse } from "next/server";

const hubUrl = () => process.env.INTEGRATION_HUB_URL || "http://127.0.0.1:3200";
export async function GET() {
  try { const response = await fetch(`${hubUrl()}/api/angel-court/inbox/scan`, { cache: "no-store" }); return NextResponse.json(await response.json(), { status: response.status }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integration Hub is unavailable." }, { status: 502 }); }
}
export async function POST() {
  try { const response = await fetch(`${hubUrl()}/api/angel-court/inbox/scan`, { method: "POST", cache: "no-store" }); return NextResponse.json(await response.json(), { status: response.status }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Integration Hub is unavailable." }, { status: 502 }); }
}
