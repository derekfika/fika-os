import crypto from "node:crypto";
import type { CanonicalRecord } from "./types";
import { stableId } from "./profiler";

export type OplocCompatibilityProposal = {
  sourceCanonicalId: string;
  sourceEntityType: "Site";
  sourceHash: string;
  sourceProvider: string;
  sourceIdentifier: string;
  sourceLabel: string;
  proposedOplocId: string;
  preservesExistingId: boolean;
  proposedPrimaryLocationType: "Site";
  lifecycleStatus: "needs-review";
  classificationBasis: string;
  duplicateCandidates: { canonicalId: string; reason: string }[];
};

export function proposeOplocCompatibility(source: CanonicalRecord, existingOplocs: CanonicalRecord[]): OplocCompatibilityProposal {
  if (source.entityType !== "Site") throw new Error("Only legacy provider-derived Site candidates can use this compatibility proposal.");
  const identities = Array.isArray(source.record.externalIdentities) ? source.record.externalIdentities.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const first = identities[0] || {};
  const provider = String(first.provider || "unknown-source");
  const identifier = String(first.externalId || source.canonicalId);
  const sourceLabel = String(source.record.name || source.canonicalId);
  const preservesExistingId = source.canonicalId.startsWith("oploc:");
  const proposedOplocId = preservesExistingId ? source.canonicalId : stableId("oploc", `${provider}:${identifier}`);
  const normalised = normalise(sourceLabel);
  const duplicateCandidates = existingOplocs.filter(record => normalise(String(record.record.approvedName || "")) === normalised || externalIdentityMatches(identities, record.record.externalIdentities)).map(record => ({ canonicalId: record.canonicalId, reason: externalIdentityMatches(identities, record.record.externalIdentities) ? "provider identity matches" : "normalised approved name matches" }));
  return { sourceCanonicalId: source.canonicalId, sourceEntityType: "Site", sourceHash: hash(stable(source.record)), sourceProvider: provider, sourceIdentifier: identifier, sourceLabel, proposedOplocId, preservesExistingId, proposedPrimaryLocationType: "Site", lifecycleStatus: "needs-review", classificationBasis: "Provider-derived Site terminology is proposal evidence only and requires explicit FIKA review.", duplicateCandidates };
}

export function buildOplocAlignmentReport(records: CanonicalRecord[]) {
  const sources = records.filter(record => record.entityType === "Site");
  const oplocs = records.filter(record => record.entityType === "OPLOC");
  const proposals = sources.map(source => proposeOplocCompatibility(source, oplocs));
  return { format: "fika.integration-hub-oploc-alignment-dry-run.v1", dryRun: true, writesPerformed: 0, sourceCount: sources.length, existingOplocCount: oplocs.length, proposalCount: proposals.length, sourceAggregateHash: hash(proposals.map(proposal => `${proposal.sourceCanonicalId}:${proposal.sourceHash}`).sort().join("\n")), targetAggregateHash: hash(proposals.map(proposal => proposal.proposedOplocId).sort().join("\n")), idPreservation: { safe: proposals.filter(proposal => proposal.preservesExistingId).length, requiresMapping: proposals.filter(proposal => !proposal.preservesExistingId).length }, duplicateProposalCount: proposals.filter(proposal => proposal.duplicateCandidates.length).length, proposals };
}

export function locationTypeIsSupported(value: string): value is "Site" | "Venue" { return value === "Site" || value === "Venue"; }
export function operationalFunctionIsLocationType(value: string) { return ["coffee bar", "restaurant", "pantry", "production kitchen", "cpu", "hospitality", "delivered-in food", "grab-and-go", "front-of-house activity", "meeting-room service", "till location"].includes(value.trim().toLowerCase()); }
function externalIdentityMatches(left: Record<string, unknown>[], rightValue: unknown) { const right = Array.isArray(rightValue) ? rightValue.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : []; return left.some(a => right.some(b => a.provider === b.provider && a.externalId === b.externalId)); }
function normalise(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`; }
