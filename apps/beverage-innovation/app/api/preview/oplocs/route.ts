import type { NextRequest } from "next/server";
import { handleBeveragePreviewOplocGet } from "@/lib/preview-oploc-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handleBeveragePreviewOplocGet(request);
}
