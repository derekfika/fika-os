import type { StagingRecord } from "./schemas";
import type { CanonicalRecord } from "./types";

type ExternalIdentity = { provider: string; externalId: string };
type SourceMapping = { sourceEntityType?: unknown; sourceIdentifier?: unknown; mappingStatus?: unknown };

export type LegendIdentityReview = {
  stagingId: string;
  displayName: unknown;
  status: unknown;
  source: Record<string, unknown>;
  candidates: Array<Record<string, unknown> & { canonicalId: string; lifecycleStatus: string; matchExplanation: string; confidence: number }>;
};

export function normaliseExternalIdentity(identity: Partial<ExternalIdentity>): ExternalIdentity | null {
  const provider = String(identity.provider || "").trim().toLowerCase();
  const externalId = String(identity.externalId || "").trim();
  return provider && externalId ? { provider, externalId } : null;
}

export function externalIdentities(record: Record<string, unknown>): ExternalIdentity[] {
  if (!Array.isArray(record.externalIdentities)) return [];
  return record.externalIdentities.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const identity = normaliseExternalIdentity(value as Partial<ExternalIdentity>);
    return identity ? [identity] : [];
  });
}

export function recordsShareProviderIdentity(left: Record<string, unknown>, right: Record<string, unknown>) {
  const rightKeys = new Set(externalIdentities(right).map(identityKey));
  return externalIdentities(left).some(identity => rightKeys.has(identityKey(identity)));
}

export function classifyProviderIdentity(records: CanonicalRecord[], entityType: string, provider: string, externalId: string) {
  const identity = normaliseExternalIdentity({ provider, externalId });
  const matches = identity ? records.filter(record => record.entityType === entityType && externalIdentities(record.record).some(candidate => identityKey(candidate) === identityKey(identity))) : [];
  if (matches.length > 1) return { kind: "conflict" as const, matches };
  if (matches.length === 1) return { kind: "linked" as const, matches, canonicalId: matches[0].canonicalId };
  return { kind: "unmatched" as const, matches };
}

export function buildLegendIdentityQueues(input: {
  staging: StagingRecord[];
  canonical: CanonicalRecord[];
  sourceMappings: SourceMapping[];
  lifecycle: (record: CanonicalRecord) => string;
  evidence: (record: Record<string, unknown>) => Record<string, unknown>;
}) {
  const decisions = new Map(input.sourceMappings
    .filter(mapping => mapping.sourceEntityType === "person-identity")
    .map(mapping => [String(mapping.sourceIdentifier || ""), String(mapping.mappingStatus || "unresolved")]));
  const active: LegendIdentityReview[] = [];
  const deferred: LegendIdentityReview[] = [];
  const missingRotaEvidence: Array<{ stagingId: string; displayName: unknown; status: unknown; source: Record<string, unknown> }> = [];

  for (const record of input.staging) {
    if (record.entityType !== "Legend" || ["approved", "excluded", "invalid", "conflict"].includes(record.state)) continue;
    const rotaStatus = String(record.normalised.rotaSiteMappingStatus || "");
    if (rotaStatus === "no-exact-rota-match") missingRotaEvidence.push({ stagingId: record.stagingId, displayName: record.normalised.displayName, status: rotaStatus, source: input.evidence(record.normalised) });

    const candidates = record.duplicateCandidates.flatMap(candidate => {
      const target = input.canonical.find(item => item.canonicalId === candidate.canonicalId && item.entityType === "Legend");
      if (!target || recordsShareProviderIdentity(record.normalised, target.record)) return [];
      return [{ canonicalId: target.canonicalId, ...input.evidence(target.record), lifecycleStatus: input.lifecycle(target), matchExplanation: candidate.reason, confidence: candidate.confidence }];
    });
    if (!candidates.length) continue;

    const item = { stagingId: record.stagingId, displayName: record.normalised.displayName, status: rotaStatus || record.state, source: input.evidence(record.normalised), candidates };
    const decision = decisions.get(record.stagingId);
    if (decision === "deferred") deferred.push(item);
    else if (!decision || decision === "unresolved") active.push(item);
  }

  return { active, deferred, missingRotaEvidence };
}

function identityKey(identity: ExternalIdentity) { return `${identity.provider}\u0000${identity.externalId}`; }
