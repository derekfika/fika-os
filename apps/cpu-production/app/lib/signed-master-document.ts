import type { ProductionOrder } from "../../lib/production-types";
import type { CpuMasterReview } from "../../lib/cpu-master-review";
import { cpuMasterReviewId, cpuMasterReviewSemanticHash } from "../../lib/cpu-master-review";
import { allergenMatrixContentHash } from "../../lib/cpu-allergen-release";
import { currentAllergenReleaseMatchesOrder, matrixSignatureScope, type ProductionPlan, type MatrixArtifact } from "./production-plan";

export function masterReviewIdentity(serviceDate: string, orders: ProductionOrder[], plans: ProductionPlan[]) {
  const members = orders.map(order => { const plan = plans.find(plan => plan.orderId === order.canonicalId); const scope = plan && matrixSignatureScope(order, allergenMatrixContentHash(plan.menuItems)); return { orderId: order.canonicalId, sourceDayId: scope?.sourceDayId, sourcePublicationId: scope?.sourcePublicationId, sourcePublicationDayId: scope?.sourcePublicationDayId, sourceVersion: scope?.sourceVersion, sourceContentHash: scope?.sourceContentHash, matrixContentHash: scope?.matrixContentHash }; });
  return { id: cpuMasterReviewId({ serviceDate, members }), hash: cpuMasterReviewSemanticHash(members) };
}
/** Read existing authority only. A site PDF or a partial date review is never a master. */
export function currentSignedMasterDocument(serviceDate: string, orders: ProductionOrder[], plans: ProductionPlan[], review?: CpuMasterReview): { artifact: MatrixArtifact; identity: string } {
  const reject = () => { throw Object.assign(new Error("No current, fully signed master allergen checker is available for this service date."), { status: 409 }); };
  if (!orders.length || orders.length > 200 || new Set(orders.map(order => order.canonicalId)).size !== orders.length) return reject();
  if (orders.some(order => order.origin !== "menu_planning" || order.status === "cancelled" || order.supersededBy || order.serviceDate !== serviceDate)) return reject();
  const identity = masterReviewIdentity(serviceDate, orders, plans);
  const ids = orders.map(order => order.canonicalId).sort();
  if (!review || review.id !== identity.id || review.serviceDate !== serviceDate || review.semanticMatrixHash !== identity.hash || review.status !== "signed" || review.finalization.state !== "completed" || JSON.stringify([...review.orderIds].sort()) !== JSON.stringify(ids)) return reject();
  let master: MatrixArtifact | undefined;
  const releases: string[] = [];
  for (const order of orders) {
    const plan = plans.find(candidate => candidate.orderId === order.canonicalId);
    const release = plan?.currentAllergenRelease;
    if (!plan || plan.masterReviewId !== review.id || !release?.releaseId || release.serviceDate !== serviceDate || !currentAllergenReleaseMatchesOrder(release, order, plan.menuItems)) return reject();
    const artifact = release.masterArtifact;
    if (!artifact?.id.startsWith(`allergen-master:${serviceDate}:`) || artifact.pdfStatus !== "generated" || artifact.driveStatus !== "saved" || !artifact.driveFileId || !/^[A-Za-z0-9_-]{1,200}$/.test(artifact.driveFileId) || !/^[a-f0-9]{64}$/i.test(artifact.contentHash)) return reject();
    const pointer = plan.masterMatrixArtifact;
    if (!pointer || pointer.id !== artifact.id || pointer.driveFileId !== artifact.driveFileId || pointer.contentHash !== artifact.contentHash) return reject();
    if (master && (master.id !== artifact.id || master.driveFileId !== artifact.driveFileId || master.contentHash !== artifact.contentHash)) return reject();
    master = artifact; releases.push(release.releaseId);
  }
  return { artifact: master!, identity: `${review.id}:${releases.sort().join(",")}:${master!.id}:${master!.driveFileId}:${master!.contentHash}` };
}
