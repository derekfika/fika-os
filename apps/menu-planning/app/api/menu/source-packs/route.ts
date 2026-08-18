import { NextResponse } from "next/server";
import manifest from "@/fixtures/source-pack-manifest.json";

export async function GET() {
  return NextResponse.json({ manifest });
}
