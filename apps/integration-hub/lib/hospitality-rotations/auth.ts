import type { NextRequest } from "next/server";
import { requireFikaSession } from "../fika-session";
import { FirestoreAuthModRepository } from "../authmod-core/firestore-repository";
import type { AuthModRepository } from "../authmod-core/repository";
import type { AuthPrincipal } from "../authmod-core/model";
import { isEffective } from "../authmod-core/model";
import { assertAllowed, createAuthModEvaluationContext, evaluateAuthority } from "../authmod-core/evaluator";
import { ROTATIONS_AUTHORITY } from "../../../shared/hospitality-rotations";

export type RotationAction = "View" | "Manage" | "Publish";
/** No role, full-access, local identity or bridge-token shortcut for this special resource. */
export async function authoriseRotation(repository: AuthModRepository, principal: AuthPrincipal, action: RotationAction) {
  if (principal.type !== "interactive") throw Object.assign(new Error("A signed-in user is required"), { status: 403 });
  const context = createAuthModEvaluationContext(repository, principal);
  const identity = await context.identity();
  if (!identity || !isEffective(identity)) throw Object.assign(new Error("Identity is not effective"), { status: 403 });
  if (action !== "View" && identity.identityKind !== "person") throw Object.assign(new Error("A person identity is required"), { status: 403 });
  assertAllowed(await evaluateAuthority(repository, { principal, ...ROTATIONS_AUTHORITY, action, scope: { kind: "organisation", ids: [] } }, context));
  return principal;
}
export async function rotationCaller(request: NextRequest, action: RotationAction) {
  const session = await requireFikaSession(request);
  const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
  return authoriseRotation(new FirestoreAuthModRepository(), principal, action);
}
