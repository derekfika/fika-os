import { fulfilmentRequirementIdentity, type FulfilmentRequirement } from "./fulfilment-requirement";
import type { DurableDomainEvent } from "./domain-events";

export type ExpectedFulfilmentSource = { sourceDomain: FulfilmentRequirement["sourceDomain"]; sourceEntityId: string; sourceVersion: number; destinationOplocId: string; status: "active" | "withdrawn" };
export type FulfilmentReconciliationIssue = { kind: "missing_requirement" | "stale_requirement" | "withdrawn_source_still_active" | "failed_event"; requirementId?: string; sourceEntityId?: string; detail: string };

export function reconcileFulfilmentRequirements(expected: ExpectedFulfilmentSource[], actual: FulfilmentRequirement[], events: DurableDomainEvent[] = []): FulfilmentReconciliationIssue[] {
  const byId = new Map(actual.map(requirement => [requirement.canonicalId, requirement]));
  const issues: FulfilmentReconciliationIssue[] = [];
  for (const source of expected) {
    const requirementId = fulfilmentRequirementIdentity(source.sourceDomain, source.sourceEntityId, source.destinationOplocId);
    const requirement = byId.get(requirementId);
    if (!requirement) { issues.push({ kind: "missing_requirement", requirementId, sourceEntityId: source.sourceEntityId, detail: `No Fulfilment Requirement exists for ${source.sourceEntityId} at ${source.destinationOplocId}.` }); continue; }
    if (source.status === "withdrawn") { if (requirement.status !== "withdrawn") issues.push({ kind: "withdrawn_source_still_active", requirementId, sourceEntityId: source.sourceEntityId, detail: `Withdrawn source ${source.sourceEntityId} still has an active downstream requirement.` }); continue; }
    if (requirement.status === "withdrawn") { issues.push({ kind: "stale_requirement", requirementId, sourceEntityId: source.sourceEntityId, detail: `Active source ${source.sourceEntityId} is represented by a withdrawn requirement.` }); continue; }
    if (requirement.sourceVersion < source.sourceVersion) issues.push({ kind: "stale_requirement", requirementId, sourceEntityId: source.sourceEntityId, detail: `Requirement ${requirementId} is at source version ${requirement.sourceVersion}; source is at ${source.sourceVersion}.` });
  }
  for (const event of events.filter(candidate => candidate.delivery.status === "failed")) issues.push({ kind: "failed_event", sourceEntityId: event.sourceAggregateId, detail: `Event ${event.eventId} failed delivery: ${event.delivery.lastError || "unknown error"}.` });
  return issues;
}
