import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { rebuildOplocReadPackage } from "@/lib/oploc-read-package";
import { rebuildServiceArrangementsReadPackage } from "@/lib/service-arrangements-read-package";
import { rebuildServiceDefinitionsReadPackage } from "@/lib/service-definitions-read-package";
import { rebuildAuthmodReferenceReadPackage } from "@/lib/authmod-reference-read-package";
import { bootstrapActiveAuthmodAccessPackages, rebuildAuthmodAccessReadPackage } from "@/lib/authmod-access-read-package";

const Query = z.object({ dataset: z.enum(["oplocs", "service-arrangements", "service-definitions", "authmod-references", "authmod-access", "authmod-access-active"]), identityId: z.string().min(1).optional() }).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin"]);
    assertPermission(actor, "canonical.edit");
    const { dataset, identityId } = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (dataset === "authmod-access" && !identityId) throw Object.assign(new Error("identityId is required to rebuild an AUTHMOD access package."), { status: 422, code: "AUTHMOD_ACCESS_IDENTITY_REQUIRED" });
    const manifest = dataset === "authmod-access-active"
      ? await bootstrapActiveAuthmodAccessPackages()
      : dataset === "authmod-access"
        ? await rebuildAuthmodAccessReadPackage(identityId!)
      : dataset === "oplocs"
      ? await rebuildOplocReadPackage()
      : dataset === "service-arrangements"
        ? await rebuildServiceArrangementsReadPackage()
        : dataset === "service-definitions"
          ? await rebuildServiceDefinitionsReadPackage()
          : await rebuildAuthmodReferenceReadPackage();
    return NextResponse.json({ dataset, manifest }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return errorResponse(error); }
}
