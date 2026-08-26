import { NextResponse } from "next/server";
import { getFikaRuntimeConfig, hasFirebaseClientConfig } from "@/lib/runtime-config";
export async function GET() { try { const runtime = getFikaRuntimeConfig(); return NextResponse.json({ local: runtime.mode === "local", localEmulatorAvailable: runtime.authMode === "emulator", googleWorkspaceAvailable: runtime.authMode === "cloud" && hasFirebaseClientConfig() }); } catch { return NextResponse.json({ local: false, localEmulatorAvailable: false, googleWorkspaceAvailable: false }, { status: 503 }); } }
