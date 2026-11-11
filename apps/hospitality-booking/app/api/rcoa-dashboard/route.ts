import { NextRequest } from "next/server";
import { rcoaDashboardDataResponse } from "@/lib/rcoa-dashboard/data-service";

export async function GET(request: NextRequest) {
  return rcoaDashboardDataResponse(request);
}
