import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { rebuildOplocReadPackage } from "@/lib/oploc-read-package";
import { rebuildServiceArrangementsReadPackage } from "@/lib/service-arrangements-read-package";
import { rebuildServiceDefinitionsReadPackage } from "@/lib/service-definitions-read-package";

const Query = z.object({ dataset: z.enum(["oplocs", "service-arrangements", "service-definitions"]) }).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin"]);
    assertPermission(actor, "canonical.edit");
    const { dataset } = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const manifest = dataset === "oplocs"
      ? await rebuildOplocReadPackage()
      : dataset === "service-arrangements"
        ? await rebuildServiceArrangementsReadPackage()
        : await rebuildServiceDefinitionsReadPackage();
    return NextResponse.json({ dataset, manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
