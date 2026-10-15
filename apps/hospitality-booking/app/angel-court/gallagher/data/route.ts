import { NextRequest } from "next/server";
import { gallagherDataResponse } from "@/lib/gallagher-data-service";

export async function GET(request: NextRequest) {
  return gallagherDataResponse(request);
}
