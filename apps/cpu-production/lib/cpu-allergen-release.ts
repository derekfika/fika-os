import { createHash } from "node:crypto";
import type { InternalMatrixSignature, MatrixArtifact, PlannedMenuItem } from "../app/lib/production-plan";

export type CpuReleaseStatus = "current" | "revoked" | "superseded";
export type CpuReleaseSignature = InternalMatrixSignature & { valid: boolean };
export type CpuReleaseDelta = { menuItemId: string; dishName: string; allergen: string; previously: string; now: string };
export type CpuAllergenRelease = {
  contractVersion: "cpu-production.signed-allergen-release.v1";
  releaseId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationId?: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  version: number;
  matrixContentHash: string;
  signedAt: string;
  signatures: CpuReleaseSignature[];
  previousReleaseId?: string;
  status: CpuReleaseStatus;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  masterArtifact: MatrixArtifact;
  derivedArtifacts: MatrixArtifact[];
  packetArtifacts: MatrixArtifact[];
  matrix: Array<{ menuItemId: string; dishName: string; allergens: Record<string, string> }>;
  deltaFromPrevious: CpuReleaseDelta[];
};

const HASH = /^[a-f0-9]{64}$/i;
const jsonHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function allergenMatrixContentHash(items: PlannedMenuItem[]) { return jsonHash(items); }

export function releaseMatrix(items: PlannedMenuItem[]) {
  return items.flatMap(item => item.subItems.map((sub, index) => ({ menuItemId: `${item.id}:${sub.id || index}`, dishName: sub.name || item.name, allergens: { ...sub.allergens } })));
}

export function allergenReleaseDelta(previous: CpuAllergenRelease | undefined, nextItems: PlannedMenuItem[]): CpuReleaseDelta[] {
  if (!previous) return [];
  const before = new Map(previous.matrix.map(row => [row.menuItemId, row]));
  const next = releaseMatrix(nextItems);
  const changes = next.flatMap(row => {
    const prior = before.get(row.menuItemId);
    const keys = new Set([...Object.keys(prior?.allergens || {}), ...Object.keys(row.allergens)]);
    return [...keys].sort().flatMap(allergen => {
      const previously = prior?.allergens[allergen] || "absent";
      const now = row.allergens[allergen] || "absent";
      return previously === now ? [] : [{ menuItemId: row.menuItemId, dishName: row.dishName, allergen, previously, now }];
    });
  });
  return [...changes, ...previous.matrix.filter(row => !next.some(candidate => candidate.menuItemId === row.menuItemId)).flatMap(row => Object.keys(row.allergens).map(allergen => ({ menuItemId: row.menuItemId, dishName: row.dishName, allergen, previously: row.allergens[allergen] || "absent", now: "absent" })))]
    .filter(change => change.previously !== change.now);
}

function requireHash(value: string, field: string) { if (!HASH.test(value)) throw new Error(`${field} must be a SHA-256 hash.`); }
function requireArtifact(artifact: MatrixArtifact, field: string) { requireHash(artifact.contentHash, `${field}.contentHash`); if (!artifact.driveFileId && !artifact.localUrl) throw new Error(`${field} must have a durable identity.`); }

export function buildCpuAllergenRelease(input: {
  serviceDate: string; sourceDayId: string; sourcePublicationId?: string; sourcePublicationDayId: string; sourceVersion: number; sourceContentHash: string; version: number; signedAt: string; signatures: InternalMatrixSignature[]; items: PlannedMenuItem[]; masterArtifact: MatrixArtifact; derivedArtifacts: MatrixArtifact[]; packetArtifacts: MatrixArtifact[]; previous?: CpuAllergenRelease;
}): CpuAllergenRelease {
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("A release version is required.");
  const roles = new Set(input.signatures.map(signature => signature.role));
  if (!roles.has("production_chef") || !roles.has("head_chef_site_manager")) throw new Error("Both required signatures are required for a release.");
  requireArtifact(input.masterArtifact, "masterArtifact");
  if (!input.sourceDayId || !input.sourcePublicationDayId || !Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) throw new Error("A published Menu Planning source-day identity is required for a release.");
  requireHash(input.sourceContentHash, "sourceContentHash");
  input.derivedArtifacts.forEach((artifact, index) => requireArtifact(artifact, `derivedArtifacts[${index}]`));
  input.packetArtifacts.forEach((artifact, index) => requireArtifact(artifact, `packetArtifacts[${index}]`));
  const matrix = releaseMatrix(input.items);
  const matrixContentHash = jsonHash(matrix);
  const expectedPlanHash = allergenMatrixContentHash(input.items);
  if (input.signatures.some(signature => !signature.scope || signature.scope.matrixContentHash !== expectedPlanHash)) throw new Error("Every release signature must be bound to the exact current publication-day matrix.");
  return {
    contractVersion: "cpu-production.signed-allergen-release.v1", releaseId: `cpu-allergen-release:${input.serviceDate}:v${input.version}`, serviceDate: input.serviceDate, sourceDayId: input.sourceDayId, ...(input.sourcePublicationId ? { sourcePublicationId: input.sourcePublicationId } : {}), sourcePublicationDayId: input.sourcePublicationDayId, sourceVersion: input.sourceVersion, sourceContentHash: input.sourceContentHash, version: input.version, matrixContentHash, signedAt: input.signedAt,
    signatures: input.signatures.map(signature => ({ ...signature, valid: true })), ...(input.previous ? { previousReleaseId: input.previous.releaseId } : {}), status: "current", masterArtifact: input.masterArtifact, derivedArtifacts: [...input.derivedArtifacts], packetArtifacts: [...input.packetArtifacts], matrix, deltaFromPrevious: allergenReleaseDelta(input.previous, input.items),
  };
}

export function revokeCpuAllergenRelease(release: CpuAllergenRelease, input: { at: string; by: string; reason: string; supersededByReleaseId?: string }): CpuAllergenRelease {
  if (release.status === "revoked") return release;
  const revokedArtifact = (artifact: MatrixArtifact) => ({ ...artifact, driveStatus: "failed" as const });
  return { ...release, status: "revoked", revokedAt: input.at, revokedBy: input.by, revokeReason: input.reason, signatures: release.signatures.map(signature => ({ ...signature, valid: false })), masterArtifact: revokedArtifact(release.masterArtifact), derivedArtifacts: release.derivedArtifacts.map(revokedArtifact), packetArtifacts: release.packetArtifacts.map(revokedArtifact) };
}

export function publishCpuAllergenRelease(current: CpuAllergenRelease | undefined, candidate: CpuAllergenRelease) {
  if (candidate.status !== "current") throw new Error("Only a current release may become current.");
  if (current && current.serviceDate !== candidate.serviceDate) throw new Error("Release service dates cannot change.");
  if (current && candidate.version <= current.version) throw new Error("Release versions must increase.");
  if (candidate.matrixContentHash !== jsonHash(candidate.matrix)) throw new Error("Release matrix hash mismatch.");
  return { ...(current ? { superseded: { ...current, status: "superseded" as const } } : {}), current: candidate };
}
