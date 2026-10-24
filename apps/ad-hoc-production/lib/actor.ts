import type { NextRequest } from "next/server";
import { requireActor } from "@hub/lib/auth";

// Local development without a Hub session only; never reachable in a production build.
const localActor = { uid: "local-ad-hoc", name: "Operations user", role: "integration-admin" as const, synthetic: true as const };

/** The authenticated Hub actor. Login alone is not enough: the Hub role is checked server-side. */
export async function requestActor(req: NextRequest) {
  try { return await requireActor(req, ["integration-admin", "reviewer"]); }
  catch (error) { if (process.env.NODE_ENV !== "production" && (error as { status?: number }).status === 401) return localActor; throw error; }
}
