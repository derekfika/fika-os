import { NextRequest } from "next/server";
import { handleAccountAction } from "./handler";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleAccountAction(request, context);
}
