import type { AccessAuditEvent, AppAssignment, ApplicationRegistryEntry, AuthIdentity, AuthorityGrant, ImportRecord, ImportRowResolution, ServicePrincipal, SiteAssignment } from "./model";
import { assertExpectedVersion, type AuthModRepository, type OplocReference } from "./repository";
export class MemoryAuthModRepository implements AuthModRepository {
  identities = new Map<string, AuthIdentity>(); applications = new Map<string, ApplicationRegistryEntry>(); oplocs = new Map<string, OplocReference>();
  siteAssignments = new Map<string, SiteAssignment>(); appAssignments = new Map<string, AppAssignment>(); grants = new Map<string, AuthorityGrant>();
  principals = new Map<string, ServicePrincipal>(); imports = new Map<string, ImportRecord>(); resolutions = new Map<string, ImportRowResolution>(); audits: AccessAuditEvent[] = [];
  constructor(seed: { applications?: ApplicationRegistryEntry[]; oplocs?: OplocReference[] } = {}) {
    for (const application of seed.applications || []) this.applications.set(application.appId, application);
    for (const oploc of seed.oplocs || []) this.oplocs.set(oploc.id, oploc);
  }
  async getIdentity(id: string) { return this.identities.get(id); } async listIdentities() { return [...this.identities.values()]; }
  async findIdentityByExternal(provider: string, uid: string) { return [...this.identities.values()].find(value => value.externalProvider === provider && value.externalUid === uid); }
  async findIdentityByEmail(email: string) { const normalized = email.trim().toLowerCase(); return [...this.identities.values()].find(value => value.normalizedEmail === normalized); }
  async findIdentityByLegend(legendId: string) { return [...this.identities.values()].find(value => value.legendId === legendId); }
  async saveIdentity(value: AuthIdentity, expectedVersion?: number) { assertExpectedVersion(this.identities.get(value.id)?.version, expectedVersion); this.identities.set(value.id, value); }
  async listApplications() { return [...this.applications.values()]; } async getApplication(appId: string) { return this.applications.get(appId); }
  async saveApplication(value: ApplicationRegistryEntry, expectedVersion?: number) { assertExpectedVersion(this.applications.get(value.appId)?.version, expectedVersion); this.applications.set(value.appId, value); }
  async listActiveOplocs() { return [...this.oplocs.values()].filter(value => value.active); }
  async listSiteAssignments(identityId: string) { return [...this.siteAssignments.values()].filter(value => value.identityId === identityId); }
  async getSiteAssignment(id: string) { return this.siteAssignments.get(id); }
  async saveSiteAssignment(value: SiteAssignment, expectedVersion?: number) { assertExpectedVersion(this.siteAssignments.get(value.id)?.version, expectedVersion); this.siteAssignments.set(value.id, value); }
  async listAppAssignments(identityId: string) { return [...this.appAssignments.values()].filter(value => value.identityId === identityId); }
  async getAppAssignment(id: string) { return this.appAssignments.get(id); }
  async saveAppAssignment(value: AppAssignment, expectedVersion?: number) { assertExpectedVersion(this.appAssignments.get(value.id)?.version, expectedVersion); this.appAssignments.set(value.id, value); }
  async listAuthorityGrants(subjectId: string, subjectType?: "human" | "service") { return [...this.grants.values()].filter(value => value.subjectId === subjectId && (!subjectType || value.subjectType === subjectType)); }
  async saveAuthorityGrant(value: AuthorityGrant, expectedVersion?: number) { assertExpectedVersion(this.grants.get(value.id)?.version, expectedVersion); this.grants.set(value.id, value); }
  async saveAuthorityGrantWithAudit(value: AuthorityGrant, audit: AccessAuditEvent, expectedVersion?: number) { assertExpectedVersion(this.grants.get(value.id)?.version, expectedVersion); this.grants.set(value.id, value); this.audits.push(audit); }
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
  async getImport(id: string) { return this.imports.get(id); }
  async saveImport(value: ImportRecord, expectedVersion?: number) { assertExpectedVersion(this.imports.get(value.id)?.version, expectedVersion); this.imports.set(value.id, value); }
  async saveImportResolution(value: ImportRowResolution, expectedVersion?: number) { assertExpectedVersion(this.resolutions.get(value.id)?.version, expectedVersion); this.resolutions.set(value.id, value); }
  async listImportResolutions(importId: string) { return [...this.resolutions.values()].filter(value => value.importId === importId); }
  async appendAudit(event: AccessAuditEvent) { this.audits.push(event); }
}
