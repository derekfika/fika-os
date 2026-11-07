import { NextResponse } from "next/server";
import { z } from "zod";
import { normaliseImportName } from "@/lib/import-preview";
import { findBeveragesByName } from "@/lib/repository";
import { beverageError, requireLocalBeverageActor } from "@/lib/runtime";

const requestSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireLocalBeverageActor(request, "Contribute");
    const { name } = requestSchema.parse(await request.json());
    const normalizedName = normaliseImportName(name);
    const duplicate = (await findBeveragesByName(normalizedName, 1)).length > 0;
    return NextResponse.json({ normalizedName, duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = beverageError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
