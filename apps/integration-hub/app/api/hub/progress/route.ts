import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { getLatestSyncRun } from "@/lib/repository";

export async function GET(req: NextRequest) {
  try {
    await requireActor(req);
    const provider = req.nextUrl.searchParams.get("provider");
    if (provider !== "brighthr" && provider !== "square") throw Object.assign(new Error("Choose a supported provider."), { status: 400 });
    return NextResponse.json({ run: await getLatestSyncRun(provider) });
  } catch (error) {
    return errorResponse(error);
  }
}
