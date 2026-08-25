export const AUTHMOD_ACTIONS = ["View", "Contribute", "Manage", "Approve", "Publish", "Administer"] as const;
export type AuthModAction = (typeof AUTHMOD_ACTIONS)[number];
export type RecordStatus = "active" | "revoked" | "expired" | "inactive";
export type IdentityLinkStatus = "unmatched" | "matched" | "needs-review";
export type PrincipalType = "human" | "service";
export type Scope = { kind: "organisation" | "oploc" | "resource"; ids: string[] };
export type EffectivePeriod = { effectiveFrom?: string; effectiveTo?: string };
export type Provenance = "standard-app-access" | "explicit-special-authority" | "import" | "migration" | "manual-override" | "system";

export type AuthIdentity = EffectivePeriod & {
  id: string; externalProvider?: string; externalUid?: string; normalizedEmail?: string; displayName: string;
  legendId?: string; identityLinkStatus: IdentityLinkStatus; status: "active" | "inactive" | "revoked";
  fullAccess: boolean;
  provenance: Provenance; createdAt: string; updatedAt: string; version: number;
};
export type ApplicationRegistryEntry = {
  appId: string; displayName: string; enabled: boolean; launchVisible: boolean; route?: string; baseUrl?: string;
  scopeModel: "none" | "oploc" | "mixed"; standardBundleId: string; standardResource: string; standardActions: AuthModAction[];
  version: number; createdAt: string; updatedAt: string; provenance: Provenance;
};
export type SiteAssignment = EffectivePeriod & {
  id: string; identityId: string; oplocId: string; status: RecordStatus; source: Provenance; reason?: string;
  grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type AppAssignment = EffectivePeriod & {
  id: string; identityId: string; appId: string; status: RecordStatus; bundleId?: string; source: Provenance;
  reason?: string; grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type AuthorityGrant = EffectivePeriod & {
  id: string; subjectType: PrincipalType; subjectId: string; appId?: string; resource: string; action: AuthModAction;
  scope: Scope; status: RecordStatus; provenance: Provenance; bundleId?: string; reason?: string;
  grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type ServicePrincipal = EffectivePeriod & {
  id: string; name: string; ownerDomain: string; description?: string; status: "active" | "revoked" | "expired";
  allowedAudiences: string[]; credentialKeys: ServiceCredentialKey[]; version: number; createdAt: string;
  updatedAt: string; provenance: Provenance;
};
export type ServiceCredentialKey = {
  keyId: string; scheme: "shared-token-transitional" | "managed-key"; createdAt: string; lastUsedAt?: string;
  expiresAt?: string; revokedAt?: string;
};
export type ImportRecord = {
  id: string; sourceKind: "spreadsheet"; originalFilename?: string; fileHash: string; parserVersion: string;
  status: "uploaded" | "previewed" | "partial" | "committed" | "rejected" | "superseded"; rowCount: number; previewId?: string;
  uploadedBy: string; uploadedAt: string; committedAt?: string; committedBy?: string; commitIdempotencyKey?: string; summary?: ImportSummary; version: number;
};
export type ImportSummary = { matched: number; possibleMatches: number; unmatched: number; newUsers: number; permissionChanges: number; deactivations: number; unresolved: number };
export type ImportRowResolution = {
  id: string; importId: string; rowNumber: number; rowHash: string; input: Record<string, string>; candidateIdentityIds: string[];
  matchReason?: string; confidence: "exact" | "possible" | "unmatched"; selectedIdentityId?: string;
  proposedChanges: ProposedAccessChange[]; unresolvedReasons: string[]; decision?: "accept" | "exclude" | "unresolved";
  decidedBy?: string; decidedAt?: string; appliedAt?: string; appliedBy?: string; appliedCommitIdempotencyKey?: string; appliedResult?: { identityId: string; appIds: string[]; oplocIds: string[]; authorityIds: string[] }; version: number;
};
export type ProposedAccessChange = { kind: "identity" | "site" | "app" | "authority"; target: string; operation: "create" | "activate" | "revoke" | "update"; detail?: string };
export type AccessAuditEvent = {
  id: string; timestamp: string; actorPrincipalId: string; actorPrincipalType: PrincipalType;
  actorSnapshot: { displayName: string; email?: string }; targetType: string; targetId: string; action: string;
  beforeState?: unknown; afterState?: unknown; scope: Scope; provenance: Provenance; correlationId?: string;
  idempotencyKey?: string; outcome: "allowed" | "committed" | "revoked" | "denied" | "rejected";
};
export type HumanPrincipal = { type: "human"; id: string; externalProvider?: string; externalUid?: string; displayName: string; email?: string };
export type ServicePrincipalIdentity = { type: "service"; id: string; displayName: string; credentialKeyId?: string };
export type AuthPrincipal = HumanPrincipal | ServicePrincipalIdentity;
export type AuthorizationDecision = {
  allowed: boolean; principalId: string; principalType: PrincipalType; appId?: string; action?: AuthModAction;
  scope?: Scope; matchedGrantIds: string[];
  reasonCode: "allowed" | "unauthenticated" | "identity-inactive" | "service-inactive" | "app-disabled" |
  "app-not-assigned" | "oploc-not-assigned" | "authority-not-granted" | "scope-not-authorized" | "invalid-request" | "store-unavailable";
};

const applicationSeed = [
  ["integration-hub", "Integration Hub", "none", "hub", "integration-hub.normal", ["View"]],
  ["cpu-production", "CPU Production", "oploc", "cpu-normal", "cpu-production.normal", ["View", "Manage"]],
  ["logistics", "Logistics", "oploc", "logistics-normal", "logistics.normal", ["View", "Manage"]],
  ["menu-planning", "Menu Planning", "oploc", "menu-normal", "menu-planning.normal", ["View", "Contribute", "Manage"]],
  ["hospitality-booking", "Hospitality Booking", "oploc", "hospitality-normal", "hospitality-booking.normal", ["View", "Contribute", "Manage"]],
  ["delivered-in", "Delivered-In", "oploc", "delivered-normal", "delivered-in.normal", ["View", "Contribute", "Manage"]],
  ["ad-hoc-production", "Ad-Hoc Production", "mixed", "ad-hoc-normal", "ad-hoc-production.normal", ["View", "Contribute", "Manage"]],
] as const;
export const V1_APPLICATIONS: readonly ApplicationRegistryEntry[] = applicationSeed.map(([appId, displayName, scopeModel, standardBundleId, standardResource, standardActions]) => ({
  appId, displayName, enabled: true, launchVisible: true, route: appId === "integration-hub" ? "/" : "/" + appId,
  scopeModel, standardBundleId, standardResource, standardActions: [...standardActions] as AuthModAction[], version: 1,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", provenance: "migration" as const,
}));
export function now() { return new Date().toISOString(); }
export function normalizeEmail(value?: string) { return value?.trim().toLowerCase() || undefined; }
export function isEffective(record: EffectivePeriod & { status: string }, at = new Date()) {
  if (record.status !== "active") return false;
  const time = at.getTime();
  if (record.effectiveFrom && Date.parse(record.effectiveFrom) > time) return false;
  if (record.effectiveTo && Date.parse(record.effectiveTo) <= time) return false;
  return true;
}
export function idempotentId(...parts: string[]) { return parts.map(part => part.trim().replace(/[^A-Za-z0-9:_-]+/g, "-")).join(":"); }
