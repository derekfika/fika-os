import type { ProjectedDay } from "./projection";

export type CurrentAllergenDocument = {
  href: string;
  releaseId: string;
  releaseVersion: string;
  signedAt: string;
};

/** Return a PDF link only when the projection carries a complete, current CPU release for this exact menu revision. */
export function currentAllergenDocument(day: ProjectedDay): CurrentAllergenDocument | undefined {
  const cpu = day.sourceLineage?.cpu;
  const signedAt = cpu?.signedAt;
  const signatures = day.cpuReview?.signatures || [];
  const href = day.drivePdfUrl || day.cpuReview?.drivePdfUrl;
  if (
    day.cpuReview?.status !== "signed" ||
    cpu?.sourceStatus !== "current" ||
    cpu.sourceCompleteness !== "complete" ||
    cpu.sourceBundleHash !== day.contentHash ||
    !cpu.releaseId ||
    !cpu.releaseVersion ||
    !signedAt ||
    !Number.isFinite(Date.parse(signedAt)) ||
    signatures.length < 2 ||
    signatures.some(signature => !signature.printedName.trim() || !Number.isFinite(Date.parse(signature.signedAt))) ||
    !href
  ) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return { href, releaseId: cpu.releaseId, releaseVersion: cpu.releaseVersion, signedAt };
}
