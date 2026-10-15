import type { HospitalityBookingGroup } from "./hospitality-group-quotes";

/** CPU owns this evidence, returned by its existing matrixStatus batch read. */
export type GroupCpuEvidence = {
  orderId: string; planStatus: string; reviewed: boolean; signatureRoles: string[];
  matrixStatus?: string;
  sourceLineage?: { productionOrderId: string; sourceBookingId?: string; sourceQuoteRevisionId?: string; sourceVersion: number };
};

export function groupLifecycleStatus(group: HospitalityBookingGroup, evidence: Record<string, GroupCpuEvidence | undefined> = {}): HospitalityBookingGroup["status"] {
  const services = group.services;
  if (services.every(s => s.lifecycleStatus === "Cancelled")) return "Cancelled";
  if (services.some(s => s.lifecycleStatus === "Cancelled")) return "Needs attention";
  if (services.some(s => !s.routing || !["cpu_required", "no_cpu_production"].includes(s.routing.status))) return "Awaiting routing";
  if (group.quote?.stale) return "Awaiting quote";
  if (group.quote?.status === "failed" || group.quote?.status === "integrity_failed") return "Needs attention";
  if (group.quote?.status === "artifact_pending" && !group.quote.stale) return "Quote preparing";
  if (!group.quote || group.quote.stale || group.quote.status !== "complete") return group.quote ? "Awaiting quote" : "New";
  const required = services.filter(s => s.routing?.status !== "no_cpu_production");
  if (!required.length) return "Completed";
  if (required.some(s => s.production && ["failed", "blocked", "reconciliation_required", "cancelled", "amended"].includes(s.production.status))) return "Needs attention";
  const sent = required.filter(s => s.production?.quoteCurrent);
  if (!sent.length) return "Ready for CPU";
  if (sent.length !== required.length) return "Partially processed";
  if (sent.some(s => evidence[s.production!.orderId]?.matrixStatus === "failed")) return "Needs attention";
  const complete = sent.every(s => {
    const p = s.production!, e = evidence[p.orderId], lineage = e?.sourceLineage;
    return e?.orderId === p.orderId && e.planStatus === "planned" && e.reviewed && e.matrixStatus === "ready" &&
      e.signatureRoles.includes("production_chef") && e.signatureRoles.includes("head_chef_site_manager") &&
      lineage?.productionOrderId === p.orderId && lineage.sourceBookingId === s.bookingId &&
      lineage.sourceQuoteRevisionId === p.quoteRevisionId && lineage.sourceVersion === p.sourceRevision;
  });
  return complete ? "Completed" : "Sent to CPU";
}
