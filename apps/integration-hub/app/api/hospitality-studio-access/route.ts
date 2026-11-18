import type { NextRequest } from "next/server";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { readStudioPreviewAccess } from "@/lib/authmod-core/hospitality-studio-admission";
import { requireBoundFikaSession } from "@/lib/fika-session";
import { db } from "@/lib/firebase-admin";
import { getFikaRuntimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export function GET(request: NextRequest) {
  return withDataTrace({
    app: "integration-hub", action: "integration-hub.hospitality-studio-access.read", path: "/api/hospitality-studio-access",
  }, async () => {
    try {
      const runtime = getFikaRuntimeConfig();
      if (runtime.mode !== "staging" || runtime.projectId !== "fika-os-dev") return problem(404);
      const access = await db.runTransaction(async transaction => {
        const repository = new FirestoreAuthModRepository("hospitality-studio-access", undefined, transaction);
        const session = await requireBoundFikaSession(request, repository);
        return readStudioPreviewAccess({
          getApplication: id => repository.getApplication(id),
          readCurrentAccess: id => repository.getRuntimeAccessPackage(id),
        }, session);
      }, { readOnly: true });
      return access ? Response.json(access, { headers }) : problem(403);
    } catch (error) {
      const status = (error as { status?: number }).status;
      return problem(status === 401 || status === 403 ? status : 503);
    }
  });
}

function problem(status: number) {
  const code = status === 401 ? "FIKA_SESSION_INVALID" : status === 403 ? "STUDIO_ACCESS_DENIED"
    : status === 404 ? "STUDIO_ACCESS_DISABLED" : "STUDIO_AUTHORITY_UNAVAILABLE";
  return Response.json({ error: { code } }, { status, headers });
}
