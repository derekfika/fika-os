import type { NextRequest } from "next/server";
import { requireActor } from "./auth";
import { assertPermission } from "./authmod";
import { requireBridgeAccess } from "./hospitality-bridge-auth";

/** Bridge-token consumers (booking portals) or signed-in Hub users may read the catalogue package. */
export async function authoriseCatalogueRead(request: NextRequest) {
  if (request.headers.get("x-fika-mnk-bridge-token")) { requireBridgeAccess(request); return; }
  assertPermission(await requireActor(request), "canonical.view");
}
