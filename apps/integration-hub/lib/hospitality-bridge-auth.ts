import type { NextRequest } from "next/server";

/** A deployment must set this secret before the Apps Script bridge is enabled. */
export function requireBridgeAccess(request: NextRequest) {
  const expected = process.env.MNK_CANON_BRIDGE_TOKEN;
  if (!expected) throw Object.assign(new Error("MNK Canon bridge is not configured."), { status: 503 });
  if (request.headers.get("x-fika-mnk-bridge-token") !== expected) throw Object.assign(new Error("MNK Canon bridge access denied."), { status: 401 });
}
