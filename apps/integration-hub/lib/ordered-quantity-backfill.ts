import type { Firestore } from "firebase-admin/firestore";
import { fulfilmentRequirementIdentity, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { stableDocumentId } from "./canonical-editor";

/**
 * One-order, idempotent backfill of the presentation-only ordered catering quantity (orderedQuantity/orderedUnit) onto an
 * EXISTING Fulfilment Requirement and its Logistics job. It never changes version, hash, status, idempotency key, operational
 * quantities or units, and it refuses to write if anything does not line up exactly.
 */
type OrderLine = { canonicalId: string; itemName: string; customerQuantity: number; customerUnit?: string; productionQuantity?: number; productionUnit?: string };
type JobContent = { description: string; quantity: number; unit: string; orderedQuantity?: number; orderedUnit?: string };
export type BackfillChange = { target: "requirement" | "job"; documentPath: string; index: number; name: string; operational: string; before: string | null; after: string };
export type BackfillPlan = {
  orderId: string; requirementId: string; jobId: string; serviceDate: string; destinationOplocId: string;
  requirementVersion: number; jobVersion: number | undefined; status: string;
  changes: BackfillChange[]; upToDate: boolean; refusals: string[];
  patches?: { lines: FulfilmentRequirement["lines"]; contents: JobContent[]; beforeLines: FulfilmentRequirement["lines"]; beforeContents: JobContent[] };
};

const ORDERS = "fikaProductionOrdersV1";
const REQUIREMENTS = "fikaFulfilmentRequirementsV1";
const JOBS = "fikaLogisticsJobsV1";
export const BACKFILL_AUDIT_COLLECTION = "fikaDataBackfillAuditV1";

export async function planOrderedQuantityBackfill(db: Firestore, orderId: string): Promise<BackfillPlan> {
  const refusals: string[] = [];
  const orderSnapshot = await db.collection(ORDERS).doc(stableDocumentId(orderId)).get();
  if (!orderSnapshot.exists) throw new Error(`Production Order ${orderId} was not found.`);
  const order = orderSnapshot.data() as { canonicalId: string; sourceEntityId?: string; destinationOplocId?: string; serviceDate?: string; lines: OrderLine[] };
  if (order.canonicalId !== orderId) throw new Error("The stored Production Order identity does not match the requested order.");
  const requirementId = fulfilmentRequirementIdentity("cpu-production", order.sourceEntityId || order.canonicalId, order.destinationOplocId || "");
  const requirementSnapshot = await db.collection(REQUIREMENTS).doc(stableDocumentId(requirementId)).get();
  if (!requirementSnapshot.exists) throw new Error(`Fulfilment Requirement ${requirementId} was not found.`);
  const requirement = requirementSnapshot.data() as FulfilmentRequirement;
  const jobId = `logistics-job:${requirementId}`;
  const jobSnapshot = await db.collection(JOBS).doc(jobId).get();
  const job = jobSnapshot.exists ? jobSnapshot.data() as { requirementId?: string; version?: number; contents: JobContent[] } : undefined;
  if (!job) refusals.push(`Logistics job ${jobId} does not exist yet; only the requirement can be backfilled.`);
  else if (job.requirementId !== requirementId) refusals.push("The Logistics job does not belong to this requirement.");

  const changes: BackfillChange[] = [];
  const lines = requirement.lines.map(line => ({ ...line }));
  const beforeLines = requirement.lines.map(line => ({ ...line }));
  const contents = (job?.contents || []).map(item => ({ ...item }));
  const beforeContents = (job?.contents || []).map(item => ({ ...item }));
  if (lines.length !== order.lines.length) refusals.push(`The requirement has ${lines.length} lines but the Production Order has ${order.lines.length}.`);
  lines.forEach((line, index) => {
    const source = order.lines.find(candidate => candidate.canonicalId === line.sourceLineId);
    if (!source) { refusals.push(`Requirement line ${index + 1} (${line.displayNameSnapshot}) has no matching Production Order line.`); return; }
    const operationalQuantity = source.productionQuantity ?? source.customerQuantity;
    const operationalUnit = source.productionUnit || source.customerUnit;
    if (line.quantity !== operationalQuantity || line.unit !== operationalUnit) { refusals.push(`Requirement line ${index + 1} (${line.displayNameSnapshot}) operational quantity/unit does not match the Production Order; refusing.`); return; }
    if (!source.customerUnit) return;
    const operational = `${line.quantity} ${line.unit}`;
    const after = `${source.customerQuantity} ${source.customerUnit}`;
    if (!(line.orderedQuantity === source.customerQuantity && line.orderedUnit === source.customerUnit)) {
      changes.push({ target: "requirement", documentPath: `${REQUIREMENTS}/${stableDocumentId(requirementId)}`, index, name: line.displayNameSnapshot, operational, before: line.orderedQuantity !== undefined ? `${line.orderedQuantity} ${line.orderedUnit}` : null, after });
      line.orderedQuantity = source.customerQuantity;
      line.orderedUnit = source.customerUnit;
    }
    const content = contents[index];
    if (!job || !content) return;
    if (content.description !== line.displayNameSnapshot || content.quantity !== line.quantity || content.unit !== line.unit) { refusals.push(`Logistics job content ${index + 1} does not match its requirement line; refusing.`); return; }
    if (content.orderedQuantity === source.customerQuantity && content.orderedUnit === source.customerUnit) return;
    changes.push({ target: "job", documentPath: `${JOBS}/${jobId}`, index, name: content.description, operational, before: content.orderedQuantity !== undefined ? `${content.orderedQuantity} ${content.orderedUnit}` : null, after });
    content.orderedQuantity = source.customerQuantity;
    content.orderedUnit = source.customerUnit;
  });
  return {
    orderId, requirementId, jobId, serviceDate: requirement.serviceDate, destinationOplocId: requirement.destinationOplocId,
    requirementVersion: requirement.version, jobVersion: job?.version, status: requirement.status, changes, upToDate: changes.length === 0 && refusals.length === 0, refusals,
    patches: { lines, contents, beforeLines, beforeContents },
  };
}

/** Writes only `lines` / `contents` (never version, hash, status or quantities), in one transaction that re-verifies the dry-run snapshot. */
export async function applyOrderedQuantityBackfill(db: Firestore, orderId: string, by: string, now = new Date().toISOString()) {
  return applyPlannedBackfill(db, await planOrderedQuantityBackfill(db, orderId), by, now);
}

/** The transactional write for a previously computed plan; refuses if the live documents no longer match the plan snapshot. */
export async function applyPlannedBackfill(db: Firestore, plan: BackfillPlan, by: string, now = new Date().toISOString()) {
  const orderId = plan.orderId;
  if (plan.refusals.length) throw new Error(`Refusing to write: ${plan.refusals.join(" | ")}`);
  if (!plan.changes.length) return { ...plan, written: false };
  const requirementRef = db.collection(REQUIREMENTS).doc(stableDocumentId(plan.requirementId));
  const jobRef = db.collection(JOBS).doc(plan.jobId);
  const auditRef = db.collection(BACKFILL_AUDIT_COLLECTION).doc(`${stableDocumentId(orderId)}:ordered-quantity:${now.replace(/[^0-9A-Za-z]/g, "")}`);
  await db.runTransaction(async transaction => {
    const [requirement, job] = await Promise.all([transaction.get(requirementRef), transaction.get(jobRef)]);
    const currentLines = (requirement.data() as FulfilmentRequirement).lines;
    const currentContents = (job.data() as { contents: JobContent[] }).contents;
    if (JSON.stringify(currentLines) !== JSON.stringify(plan.patches!.beforeLines) || JSON.stringify(currentContents) !== JSON.stringify(plan.patches!.beforeContents)) throw new Error("The requirement or job changed since the dry run; nothing was written. Re-run the dry run.");
    if ((requirement.data() as FulfilmentRequirement).version !== plan.requirementVersion) throw new Error("The requirement version changed since the dry run; nothing was written.");
    transaction.update(requirementRef, { lines: plan.patches!.lines });
    transaction.update(jobRef, { contents: plan.patches!.contents });
    transaction.create(auditRef, { kind: "ordered-quantity-backfill", orderId, requirementId: plan.requirementId, jobId: plan.jobId, by, at: now, requirementVersion: plan.requirementVersion, changes: plan.changes });
  });
  return { ...plan, written: true };
}
