import type { AccessAuditEvent, AppAssignment, ApplicationRegistryEntry, AuditPage, AuthIdentity, AuthorityGrant, CustodianAssignment, DelegationRecord, ImportRecord, ImportRowResolution, LegendReference, ServicePrincipal, SiteAssignment } from "./model";
export type OplocReference = { id: string; label: string; active: boolean };
export type AuthModRepository = {
  getIdentity(id: string): Promise<AuthIdentity | undefined>; listIdentities(): Promise<AuthIdentity[]>;
  listLegendReferences(search?: string, limit?: number): Promise<LegendReference[]>;
  findIdentityByExternal(provider: string, uid: string): Promise<AuthIdentity | undefined>; findIdentityByEmail(email: string): Promise<AuthIdentity | undefined>; findIdentityByLegend(legendId: string): Promise<AuthIdentity | undefined>;
  saveIdentity(identity: AuthIdentity, expectedVersion?: number): Promise<void>; saveIdentityWithAudit(identity: AuthIdentity, audit: AccessAuditEvent, expectedVersion?: number): Promise<void>;
  listCustodianAssignments(operationalIdentityId: string): Promise<CustodianAssignment[]>; saveCustodianHandover(input: { prior?: CustodianAssignment; next: CustodianAssignment; audit: AccessAuditEvent; expectedPriorVersion?: number }): Promise<void>;
  listApplications(): Promise<ApplicationRegistryEntry[]>; getApplication(appId: string): Promise<ApplicationRegistryEntry | undefined>;
  saveApplication(application: ApplicationRegistryEntry, expectedVersion?: number): Promise<void>; listActiveOplocs(): Promise<OplocReference[]>; getActiveOploc(oplocId: string): Promise<OplocReference | undefined>;
  listSiteAssignments(identityId: string): Promise<SiteAssignment[]>; getSiteAssignment(id: string): Promise<SiteAssignment | undefined>;
  saveSiteAssignment(assignment: SiteAssignment, expectedVersion?: number): Promise<void>; saveSiteAssignmentWithAudit(assignment: SiteAssignment, audit: AccessAuditEvent, expectedVersion?: number): Promise<void>;
  listAppAssignments(identityId: string): Promise<AppAssignment[]>; getAppAssignment(id: string): Promise<AppAssignment | undefined>;
  saveAppAssignment(assignment: AppAssignment, expectedVersion?: number): Promise<void>;
  listAuthorityGrants(subjectId: string, subjectType?: "interactive" | "service"): Promise<AuthorityGrant[]>; saveAuthorityGrant(grant: AuthorityGrant, expectedVersion?: number): Promise<void>; saveAuthorityGrantWithAudit(grant: AuthorityGrant, audit: AccessAuditEvent, expectedVersion?: number): Promise<void>;
  getDelegation(id: string): Promise<DelegationRecord | undefined>; listDelegations(delegateId?: string): Promise<DelegationRecord[]>; saveDelegationWithGrant(input: { delegation: DelegationRecord; grant: AuthorityGrant; audit: AccessAuditEvent }): Promise<void>;
  saveStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }): Promise<void>;
  revokeStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }): Promise<void>;
  getServicePrincipal(id: string): Promise<ServicePrincipal | undefined>; listServicePrincipals(): Promise<ServicePrincipal[]>;
  saveServicePrincipal(principal: ServicePrincipal, expectedVersion?: number): Promise<void>; saveServicePrincipalWithAudit(principal: ServicePrincipal, audit: AccessAuditEvent, expectedVersion?: number): Promise<void>;
  getImport(id: string): Promise<ImportRecord | undefined>; listImports(limit?: number): Promise<ImportRecord[]>; saveImport(record: ImportRecord, expectedVersion?: number): Promise<void>; saveImportResolution(resolution: ImportRowResolution, expectedVersion?: number): Promise<void>;
  listImportResolutions(importId: string): Promise<ImportRowResolution[]>; listAuditEvents(input?: { limit?: number; cursor?: string; actorId?: string; targetId?: string }): Promise<AuditPage>; appendAudit(event: AccessAuditEvent): Promise<void>;
};
export class AuthModStoreUnavailable extends Error { status = 503; code = "AUTHMOD_STORE_UNAVAILABLE"; constructor(message = "AUTHMOD authorization data is unavailable.") { super(message); } }
export function assertExpectedVersion(actual: number | undefined, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && actual !== expectedVersion) throw Object.assign(new Error("AUTHMOD record changed since it was read."), { status: 409, code: "AUTHMOD_VERSION_CONFLICT" });
}
