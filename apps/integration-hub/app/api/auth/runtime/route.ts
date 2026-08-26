import { NextResponse } from "next/server";
import { getFikaRuntimeConfig } from "@/lib/runtime-config";
export async function GET() { try { return NextResponse.json({ local: getFikaRuntimeConfig().mode === "local" }); } catch { return NextResponse.json({ local: false }, { status: 503 }); } }
