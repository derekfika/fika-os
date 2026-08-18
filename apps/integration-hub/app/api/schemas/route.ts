import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { SchemaCatalogue } from "@/lib/schema-catalogue";
import { canonicalCountsByType } from "@/lib/repository";

export async function GET(req: NextRequest) {
  try {
    await requireActor(req);
    const existingCounts = await canonicalCountsByType();
    // Counts describe canonical instances; definitions remain deliberate code artefacts.
    const counts = Object.fromEntries(SchemaCatalogue.map(definition => [definition.entityType, existingCounts[definition.entityType] || 0]));
    return NextResponse.json({ schemas: SchemaCatalogue, counts });
  } catch (error) { return errorResponse(error); }
}
