import crypto from "node:crypto";
import type { Actor } from "./auth";
import type { HubState, PromotionManifest } from "./types";
import { lifecycleOf } from "./data-governance";
import { isImportDeferred } from "./import-policy";

export function createManifest(state: HubState, actor: Actor, target: string): PromotionManifest {
  const blockingErrorCount = state.staging.flatMap(r => r.issues).filter(i => i.severity === "blocking" && !["excluded", "approved"].includes(state.staging.find(r => r.issues.includes(i))?.state || "")).length;
  const externalIdentityConflicts = state.staging.filter(r => r.state === "conflict").length;
  const unresolved = state.staging.filter(r => ["unresolved", "possible-duplicate", "conflict", "ready"].includes(r.state)).length;
  const missingRelationships = state.staging.filter(r => r.state === "approved" && r.entityType === "Absence" && !r.normalised.legendId).length;
  const publishable = state.canonical.filter(record => lifecycleOf(record) === "published" && !isImportDeferred(record.entityType));
  const blockers = [blockingErrorCount ? `${blockingErrorCount} blocking validation error(s) remain.` : "", externalIdentityConflicts ? `${externalIdentityConflicts} external identity conflict(s) remain.` : "", unresolved ? `${unresolved} record(s) remain unresolved or unapproved.` : "", missingRelationships ? `${missingRelationships} required relationship(s) are missing.` : "", !publishable.length ? "No explicitly published canonical records are eligible." : "", target !== "fika-os-dev" ? "Target is not allow-listed." : ""].filter(Boolean);
  const reviewCounts = Object.fromEntries(["approved", "excluded", "unresolved", "invalid", "possible-duplicate", "conflict", "ready"].map(status => [status, state.staging.filter(r => r.state === status).length]));
  return { manifestId: `manifest:${crypto.randomUUID()}`, version: state.manifests.length + 1, createdAt: new Date().toISOString(), createdBy: actor.uid, schemaVersion: "0.1.0", mappingVersions: [...new Set(state.mappings.map(m => m.version))], sourceHashes: [...new Set(state.imports.map(i => i.fileHash))], countsByEntity: Object.fromEntries([...new Set(publishable.map(r => r.entityType))].map(type => [type, publishable.filter(r => r.entityType === type).length])), reviewCounts, blockingErrorCount, externalIdentityConflicts, dataHashes: publishable.map(r => r.dataHash), intendedTarget: "fika-os-dev", uploadOccurred: false, valid: blockers.length === 0, blockers };
}
