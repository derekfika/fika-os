import type { AdHocAllergenCheckerStatus } from "../../shared/ad-hoc-production-contract";
import type { AdHocRequest } from "./ad-hoc-domain";

const REQUIRED_ROLES = ["production_chef", "head_chef_site_manager"] as const;

export function currentSignedChecker(checker: AdHocAllergenCheckerStatus | undefined, request: Pick<AdHocRequest, "status" | "sentVersion">, hasUnsentEdits = false) {
  return Boolean(!hasUnsentEdits && request.status === "SENT_TO_CPU" && checker?.state === "ready"
    && checker.sourceVersion !== undefined && checker.sourceVersion === request.sentVersion
    && REQUIRED_ROLES.every(role => checker.signatures?.some(signature => signature.role === role)));
}

export function allergenCheckerDisplay(checker: AdHocAllergenCheckerStatus | undefined, request: Pick<AdHocRequest, "status" | "sentVersion">, hasUnsentEdits = false) {
  if (request.status === "NEEDS_UPDATE" || hasUnsentEdits || checker?.state === "revoked" || checker?.state === "stale"
    || checker?.state === "ready" && !currentSignedChecker(checker, request)) return "Requires re-review" as const;
  if (checker?.state === "ready" && currentSignedChecker(checker, request)) return "Signed and available" as const;
  if (checker?.state === "unsigned" || checker?.state === "pending") {
    const signatures = checker.signatures || [];
    if (REQUIRED_ROLES.every(role => signatures.some(signature => signature.role === role))) return "Unavailable/error" as const;
    return signatures.length ? "Awaiting signatures" as const : "Awaiting CPU review" as const;
  }
  return "Unavailable/error" as const;
}
