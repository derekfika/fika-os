export const AUTHMOD_ACTIONS = ["View", "Contribute", "Manage", "Approve", "Publish", "Administer"] as const;
export type AuthModAction = (typeof AUTHMOD_ACTIONS)[number];
export type RecordStatus = "active" | "revoked" | "expired" | "inactive";
export type IdentityLinkStatus = "unmatched" | "matched" | "needs-review";
export type PrincipalType = "interactive" | "service";
export type IdentityKind = "person" | "operational";
export type AccessType = "permanent" | "temporary" | "cover" | "delegated";
export type Scope = { kind: "organisation" | "oploc" | "resource"; ids: string[] };
export type EffectivePeriod = { effectiveFrom?: string; effectiveTo?: string };
export type Provenance = "standard-app-access" | "explicit-special-authority" | "import" | "migration" | "manual-override" | "system";

export type AuthIdentity = EffectivePeriod & {
  id: string; externalProvider?: string; externalUid?: string; normalizedEmail?: string; displayName: string;
  identityKind: IdentityKind; representedOplocId?: string; operationalPurpose?: string;
  legendId?: string; identityLinkStatus: IdentityLinkStatus; status: "active" | "inactive" | "revoked";
  fullAccess: boolean;
  provenance: Provenance; createdAt: string; updatedAt: string; version: number;
};
export type CustodianAssignment = EffectivePeriod & {
  id: string; operationalIdentityId: string; custodianLegendId: string; status: RecordStatus; reason?: string;
  assignedBy: string; revokedBy?: string; provenance: Provenance; version: number; createdAt: string; updatedAt: string;
};
export type ApplicationRegistryEntry = {
  appId: string; displayName: string; enabled: boolean; launchVisible: boolean; route?: string; baseUrl?: string;
  scopeModel: "none" | "oploc" | "mixed"; standardBundleId: string; standardResource: string; standardActions: AuthModAction[];
  version: number; createdAt: string; updatedAt: string; provenance: Provenance;
};
export type SiteAssignment = EffectivePeriod & {
  id: string; identityId: string; oplocId: string; status: RecordStatus; source: Provenance; accessType?: AccessType; reason?: string;
  grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type AppAssignment = EffectivePeriod & {
  id: string; identityId: string; appId: string; status: RecordStatus; bundleId?: string; source: Provenance; accessType?: AccessType;
  reason?: string; grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type AuthorityGrant = EffectivePeriod & {
  id: string; subjectType: PrincipalType; subjectId: string; appId?: string; resource: string; action: AuthModAction;
  scope: Scope; status: RecordStatus; provenance: Provenance; bundleId?: string; accessType?: AccessType; delegationSourceGrantId?: string; reason?: string;
  grantedBy?: string; revokedBy?: string; version: number; createdAt: string; updatedAt: string;
};
export type DelegationRecord = EffectivePeriod & {
  id: string; delegatorId: string; delegateId: string; sourceAuthorityGrantId: string; delegatedAuthorityGrantId: string;
  appId: string; resource: string; action: AuthModAction; scope: Scope; status: RecordStatus; reason: string; createdBy: string;
  createdAt: string; updatedAt: string; version: number;
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
  id: string; sourceKind: "spreadsheet"; mode: "workspace-bootstrap" | "authmod-access"; originalFilename?: string; fileHash: string; parserVersion: string;
  status: "uploaded" | "previewed" | "partial" | "committed" | "rejected" | "superseded"; rowCount: number; previewId?: string;
  uploadedBy: string; uploadedAt: string; committedAt?: string; committedBy?: string; commitIdempotencyKey?: string; summary?: ImportSummary; version: number;
};
export type ImportSummary = { matched: number; possibleMatches: number; unmatched: number; newUsers: number; permissionChanges: number; deactivations: number; unresolved: number };
export type ImportRowResolution = {
  id: string; importId: string; rowNumber: number; rowHash: string; input: Record<string, string>; candidateIdentityIds: string[];
  matchReason?: string; confidence: "exact" | "possible" | "unmatched"; selectedIdentityId?: string; suggestedIdentityKind?: IdentityKind;
  proposedChanges: ProposedAccessChange[]; unresolvedReasons: string[]; decision?: "accept" | "exclude" | "unresolved";
  decidedBy?: string; decidedAt?: string; appliedAt?: string; appliedBy?: string; appliedCommitIdempotencyKey?: string; appliedResult?: { identityId: string; appIds: string[]; oplocIds: string[]; authorityIds: string[] }; version: number;
};
export type ProposedAccessChange = { kind: "identity" | "site" | "app" | "authority"; target: string; operation: "create" | "activate" | "revoke" | "update"; detail?: string };
export type AccessAuditEvent = {
  id: string; timestamp: string; actorPrincipalId: string; actorPrincipalType: PrincipalType;
  actorSnapshot: { displayName: string; email?: string; identityKind?: IdentityKind; representedOplocId?: string; primaryCustodianLegendId?: string }; targetType: string; targetId: string; action: string;
  beforeState?: unknown; afterState?: unknown; scope: Scope; provenance: Provenance; correlationId?: string;
  idempotencyKey?: string; outcome: "allowed" | "committed" | "revoked" | "denied" | "rejected";
};
export type InteractivePrincipal = { type: "interactive"; id: string; externalProvider?: string; externalUid?: string; displayName: string; email?: string; identityKind?: IdentityKind; representedOplocId?: string; primaryCustodianLegendId?: string };
export type ServicePrincipalIdentity = { type: "service"; id: string; displayName: string; credentialKeyId?: string };
export type AuthPrincipal = InteractivePrincipal | ServicePrincipalIdentity;
export type AuthorizationDecision = {
  allowed: boolean; principalId: string; principalType: PrincipalType; appId?: string; action?: AuthModAction;
  scope?: Scope; matchedGrantIds: string[];
  reasonCode: "allowed" | "unauthenticated" | "identity-inactive" | "service-inactive" | "app-disabled" |
  "app-not-assigned" | "oploc-not-assigned" | "authority-not-granted" | "scope-not-authorized" | "invalid-request" | "store-unavailable";
};
export type LegendReference = { id: string; label: string; active: boolean };
export type AuditPage = { events: AccessAuditEvent[]; nextCursor?: string };

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
export function assertValidEffectivePeriod(period?: EffectivePeriod, requiresEnd = false) {
  if (!period?.effectiveFrom && !period?.effectiveTo && !requiresEnd) return;
  if (!period?.effectiveFrom || !period.effectiveTo) throw Object.assign(new Error("A fixed effective period is required."), { status: 422, code: "AUTHMOD_EFFECTIVE_PERIOD_REQUIRED" });
  if (Date.parse(period.effectiveFrom) >= Date.parse(period.effectiveTo)) throw Object.assign(new Error("effectiveFrom must be before effectiveTo."), { status: 422, code: "AUTHMOD_EFFECTIVE_PERIOD_INVALID" });
}
export function effectiveStatus(record: EffectivePeriod & { status: RecordStatus }, at = new Date()): "active" | "scheduled" | "expired" | "revoked" {
  if (record.status === "revoked") return "revoked";
  if (record.status !== "active") return record.status === "expired" ? "expired" : "revoked";
  if (record.effectiveFrom && Date.parse(record.effectiveFrom) > at.getTime()) return "scheduled";
  if (record.effectiveTo && Date.parse(record.effectiveTo) <= at.getTime()) return "expired";
  return "active";
}
export function idempotentId(...parts: string[]) { return parts.map(part => part.trim().replace(/[^A-Za-z0-9:_-]+/g, "-")).join(":"); }
