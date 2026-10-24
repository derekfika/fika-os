import type { NextRequest } from "next/server";
import { requireActor } from "@hub/lib/auth";

// Synthetic development actor. It is only ever issued when ALL of these hold:
// a non-production build, the explicit local runtime mode (unset means local on
// a developer machine, but staging/production set FIKA_RUNTIME_MODE), and no
// hosted-runtime marker. Anything else fails closed with the Hub's 401.
const localActor = { uid: "local-ad-hoc", name: "Operations user", role: "integration-admin" as const, synthetic: true as const };

export function localActorAllowed(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV === "production") return false;
  if ((env.FIKA_RUNTIME_MODE || "local") !== "local") return false;
  if (env.K_SERVICE || env.FUNCTION_TARGET || env.FIREBASE_CONFIG || env.GAE_ENV) return false;
  return true;
}

/** The authenticated Hub actor. Login alone is not enough: the Hub role is checked server-side. */
export async function requestActor(req: NextRequest) {
  try { return await requireActor(req, ["integration-admin", "reviewer"]); }
  catch (error) { if ((error as { status?: number }).status === 401 && localActorAllowed()) return localActor; throw error; }
}
