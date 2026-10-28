import { forwardHospitalityRotations } from "@/lib/hospitality-rotations-hub-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return forwardHospitalityRotations(request, "GET");
}

export function POST(request: Request) {
  return forwardHospitalityRotations(request, "POST");
}
