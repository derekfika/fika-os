import { forwardRotations } from "@/lib/hospitality-rotations-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) { return forwardRotations(request, "GET"); }
export function POST(request: Request) { return forwardRotations(request, "POST"); }
