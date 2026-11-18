import { fikaBuildIdentity } from "@fika/server-shared/build-identity";

export const dynamic = "force-dynamic";

export function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    return Response.json({ appId: "hospitality-menu-studio", ...fikaBuildIdentity() }, { headers });
  } catch {
    return Response.json({ code: "BUILD_PROVENANCE_UNAVAILABLE" }, { status: 503, headers });
  }
}
