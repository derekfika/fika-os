import type { NextRequest } from "next/server";
import { AD_HOC_ALLERGEN_CHECKER_API, type AdHocAllergenCheckerReport } from "../../shared/ad-hoc-production-contract";
import { isAdHocProductionOrder } from "./ad-hoc-order";
import type { CpuAllergenRelease } from "./cpu-allergen-release";
import type { ProductionPlan } from "../app/lib/production-plan";
import { hubJson } from "./production-http-client";

type PlanView = Pick<ProductionPlan, "orderId" | "currentAllergenRelease" | "allergenReleaseHistory" | "matrixArtifact" | "signedMatrixArtifact" | "masterMatrixArtifact">;

const hasDurableLink = (release: CpuAllergenRelease) => Boolean(release.masterArtifact?.driveUrl);
const signersOf = (release: CpuAllergenRelease) => release.signatures.filter(signature => signature.valid !== false).map(signature => ({ role: signature.role, name: signature.printedName }));

/**
 * What CPU tells the Hub about an Ad-Hoc order's signed allergen checker. A "signed" report exists only for a current, fully
 * materialised release with a durable PDF link; a "withdrawn" report only for a release that had such a link and is no longer
 * current. Anything else (nothing signed, or a release still preparing its PDF) reports nothing.
 */
export function adHocAllergenCheckerReport(plan: PlanView | undefined): AdHocAllergenCheckerReport | undefined {
  if (!plan || !isAdHocProductionOrder({ canonicalId: plan.orderId, origin: "cpu_created" })) return undefined;
  const current = plan.currentAllergenRelease;
  if (current && current.status === "current" && current.materializationStatus === "ready" && hasDurableLink(current) && current.sourceRevision) {
    return { canonicalId: plan.orderId, state: "signed", releaseId: current.releaseId, releaseVersion: current.version, sourceRevision: current.sourceRevision, ...(current.masterArtifact.fileName ? { fileName: current.masterArtifact.fileName } : {}), driveUrl: current.masterArtifact.driveUrl!, signedAt: current.signedAt, signers: signersOf(current) };
  }
  if (current && ["pending", "current"].includes(current.status)) return undefined;
  const last = [...(plan.allergenReleaseHistory || [])].reverse().find(release => hasDurableLink(release) && release.sourceRevision);
  if (!last) return undefined;
  return { canonicalId: plan.orderId, state: "withdrawn", releaseId: last.releaseId, releaseVersion: last.version, sourceRevision: last.sourceRevision!, ...(last.masterArtifact.fileName ? { fileName: last.masterArtifact.fileName } : {}), signedAt: last.signedAt, signers: signersOf(last), reason: "The allergen matrix was changed after it was signed." };
}

/** Best-effort: a Hub outage must never fail or roll back a CPU sign-off. The next CPU write for the order re-reports. */
export async function reportAdHocAllergenChecker(request: NextRequest, plan: PlanView | undefined) {
  const report = adHocAllergenCheckerReport(plan);
  if (!report) return { reported: false as const };
  try {
    await hubJson(request, AD_HOC_ALLERGEN_CHECKER_API, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(report) }, (value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
    return { reported: true as const, state: report.state };
  } catch (error) {
    console.error("FIKA Ad-Hoc allergen checker report failed", { app: "cpu-production", operation: "ad-hoc-allergen-checker-report", productionOrderId: report.canonicalId, state: report.state, errorMessage: error instanceof Error ? error.message : String(error) });
    return { reported: false as const, failed: true as const };
  }
}
