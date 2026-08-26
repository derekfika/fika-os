import type { AccessAuditEvent, AppAssignment, ApplicationRegistryEntry, AuditPage, AuthIdentity, AuthorityGrant, CustodianAssignment, DelegationRecord, ImportRecord, ImportRowResolution, LegendReference, ServicePrincipal, SiteAssignment } from "./model";
import { assertExpectedVersion, type AuthModRepository, type OplocReference } from "./repository";
export class MemoryAuthModRepository implements AuthModRepository {
  identities = new Map<string, AuthIdentity>(); applications = new Map<string, ApplicationRegistryEntry>(); oplocs = new Map<string, OplocReference>();
  siteAssignments = new Map<string, SiteAssignment>(); appAssignments = new Map<string, AppAssignment>(); grants = new Map<string, AuthorityGrant>(); custodians = new Map<string, CustodianAssignment>();
  principals = new Map<string, ServicePrincipal>(); delegations = new Map<string, DelegationRecord>(); imports = new Map<string, ImportRecord>(); resolutions = new Map<string, ImportRowResolution>(); audits: AccessAuditEvent[] = [];
  constructor(seed: { applications?: ApplicationRegistryEntry[]; oplocs?: OplocReference[] } = {}) {
    for (const application of seed.applications || []) this.applications.set(application.appId, application);
    for (const oploc of seed.oplocs || []) this.oplocs.set(oploc.id, oploc);
  }
  async getIdentity(id: string) { return this.identities.get(id); } async listIdentities() { return [...this.identities.values()]; }
  async listLegendReferences(search = "", limit = 100) { const needle = search.trim().toLowerCase(); return [...this.identities.values()].filter(value => value.legendId && (!needle || value.displayName.toLowerCase().includes(needle))).slice(0, limit).map(value => ({ id: value.legendId!, label: value.displayName, active: value.status === "active" })); }
  async findIdentityByExternal(provider: string, uid: string) { return (await this.findIdentitiesByExternal(provider, uid, 1))[0]; }
  async findIdentitiesByExternal(provider: string, uid: string, limit = 2) { return [...this.identities.values()].filter(value => value.externalProvider === provider && value.externalUid === uid).slice(0, limit); }
  async findIdentityByEmail(email: string) { return (await this.findIdentitiesByEmail(email, 1))[0]; }
  async findIdentitiesByEmail(email: string, limit = 2) { const normalized = email.trim().toLowerCase(); return [...this.identities.values()].filter(value => value.normalizedEmail === normalized).slice(0, limit); }
  async findIdentityByLegend(legendId: string) { return [...this.identities.values()].find(value => value.legendId === legendId); }
  async saveIdentity(value: AuthIdentity, expectedVersion?: number) { assertExpectedVersion(this.identities.get(value.id)?.version, expectedVersion); this.identities.set(value.id, value); }
  async saveIdentityWithAudit(value: AuthIdentity, audit: AccessAuditEvent, expectedVersion?: number) { assertExpectedVersion(this.identities.get(value.id)?.version, expectedVersion); this.identities.set(value.id, value); this.audits.push(audit); }
  async listCustodianAssignments(operationalIdentityId: string) { return [...this.custodians.values()].filter(value => value.operationalIdentityId === operationalIdentityId); }
  async saveCustodianHandover(input: { prior?: CustodianAssignment; next: CustodianAssignment; audit: AccessAuditEvent; expectedPriorVersion?: number }) { assertExpectedVersion(input.prior ? this.custodians.get(input.prior.id)?.version : undefined, input.expectedPriorVersion); if (input.prior) this.custodians.set(input.prior.id, input.prior); this.custodians.set(input.next.id, input.next); this.audits.push(input.audit); }
  async listApplications() { return [...this.applications.values()]; } async getApplication(appId: string) { return this.applications.get(appId); }
  async saveApplication(value: ApplicationRegistryEntry, expectedVersion?: number) { assertExpectedVersion(this.applications.get(value.appId)?.version, expectedVersion); this.applications.set(value.appId, value); }
  async listActiveOplocs() { return [...this.oplocs.values()].filter(value => value.active); }
  async getActiveOploc(oplocId: string) { const value = this.oplocs.get(oplocId); return value?.active ? value : undefined; }
  async listSiteAssignments(identityId: string) { return [...this.siteAssignments.values()].filter(value => value.identityId === identityId); }
  async getSiteAssignment(id: string) { return this.siteAssignments.get(id); }
  async saveSiteAssignment(value: SiteAssignment, expectedVersion?: number) { assertExpectedVersion(this.siteAssignments.get(value.id)?.version, expectedVersion); this.siteAssignments.set(value.id, value); }
  async saveSiteAssignmentWithAudit(value: SiteAssignment, audit: AccessAuditEvent, expectedVersion?: number) { assertExpectedVersion(this.siteAssignments.get(value.id)?.version, expectedVersion); this.siteAssignments.set(value.id, value); this.audits.push(audit); }
  async listAppAssignments(identityId: string) { return [...this.appAssignments.values()].filter(value => value.identityId === identityId); }
  async getAppAssignment(id: string) { return this.appAssignments.get(id); }
  async saveAppAssignment(value: AppAssignment, expectedVersion?: number) { assertExpectedVersion(this.appAssignments.get(value.id)?.version, expectedVersion); this.appAssignments.set(value.id, value); }
  async listAuthorityGrants(subjectId: string, subjectType?: "interactive" | "service") { return [...this.grants.values()].filter(value => value.subjectId === subjectId && (!subjectType || value.subjectType === subjectType)); }
  async saveAuthorityGrant(value: AuthorityGrant, expectedVersion?: number) { assertExpectedVersion(this.grants.get(value.id)?.version, expectedVersion); this.grants.set(value.id, value); }
  async saveAuthorityGrantWithAudit(value: AuthorityGrant, audit: AccessAuditEvent, expectedVersion?: number) { assertExpectedVersion(this.grants.get(value.id)?.version, expectedVersion); this.grants.set(value.id, value); this.audits.push(audit); }
  async getDelegation(id: string) { return this.delegations.get(id); } async listDelegations(delegateId?: string) { return [...this.delegations.values()].filter(value => !delegateId || value.delegateId === delegateId); }
  async saveDelegationWithGrant(input: { delegation: DelegationRecord; grant: AuthorityGrant; audit: AccessAuditEvent }) { this.delegations.set(input.delegation.id, input.delegation); this.grants.set(input.grant.id, input.grant); this.audits.push(input.audit); }
  async saveStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    assertExpectedVersion(this.appAssignments.get(input.assignment.id)?.version, input.expectedAssignmentVersion);
    this.appAssignments.set(input.assignment.id, input.assignment);
    for (const grant of input.grants) this.grants.set(grant.id, grant);
    if (input.audit) this.audits.push(input.audit);
  }
  async revokeStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    assertExpectedVersion(this.appAssignments.get(input.assignment.id)?.version, input.expectedAssignmentVersion);
    this.appAssignments.set(input.assignment.id, input.assignment);
    for (const grant of input.grants) this.grants.set(grant.id, grant);
    if (input.audit) this.audits.push(input.audit);
  }
  async getServicePrincipal(id: string) { return this.principals.get(id); } async listServicePrincipals() { return [...this.principals.values()]; }
  async saveServicePrincipal(value: ServicePrincipal, expectedVersion?: number) { assertExpectedVersion(this.principals.get(value.id)?.version, expectedVersion); this.principals.set(value.id, value); }
  async saveServicePrincipalWithAudit(value: ServicePrincipal, audit: AccessAuditEvent, expectedVersion?: number) { assertExpectedVersion(this.principals.get(value.id)?.version, expectedVersion); this.principals.set(value.id, value); this.audits.push(audit); }
  async getImport(id: string) { return this.imports.get(id); } async listImports(limit = 100) { return [...this.imports.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, limit); }
  async saveImport(value: ImportRecord, expectedVersion?: number) { assertExpectedVersion(this.imports.get(value.id)?.version, expectedVersion); this.imports.set(value.id, value); }
  async saveImportResolution(value: ImportRowResolution, expectedVersion?: number) { assertExpectedVersion(this.resolutions.get(value.id)?.version, expectedVersion); this.resolutions.set(value.id, value); }
  async listImportResolutions(importId: string) { return [...this.resolutions.values()].filter(value => value.importId === importId); }
  async listAuditEvents(input: { limit?: number; cursor?: string; actorId?: string; targetId?: string } = {}): Promise<AuditPage> { const limit = Math.min(input.limit || 50, 200); const filtered = this.audits.filter(event => (!input.actorId || event.actorPrincipalId === input.actorId) && (!input.targetId || event.targetId === input.targetId)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); return { events: filtered.slice(0, limit), ...(filtered.length > limit ? { nextCursor: filtered[limit - 1].timestamp } : {}) }; }
  async appendAudit(event: AccessAuditEvent) { this.audits.push(event); }
}
