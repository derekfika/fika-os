import { fikaBuildIdentity } from "@fika/server-shared/build-identity";

export const dynamic = "force-dynamic";

export function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  try {
    // Next inlines the configured SHA at this direct environment reference.
    // In dev, reading the previous production BUILD_ID can report stale provenance.
    const identity = fikaBuildIdentity({ ...process.env, FIKA_BUILD_SHA: process.env.FIKA_BUILD_SHA });
    return Response.json({ appId: "hospitality-menu-studio", ...identity }, { headers });
  } catch {
    return Response.json({ code: "BUILD_PROVENANCE_UNAVAILABLE" }, { status: 503, headers });
  }
}
