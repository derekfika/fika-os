import type { DocumentData } from "firebase-admin/firestore";
import { db } from "../firebase-admin";
import type { AccessAuditEvent, AppAssignment, ApplicationRegistryEntry, AuthIdentity, AuthorityGrant, ImportRecord, ImportRowResolution, ServicePrincipal, SiteAssignment } from "./model";
import { assertExpectedVersion, type AuthModRepository, type OplocReference } from "./repository";
const collections = { identities: "authmodIdentities", applications: "authmodApplications", sites: "authmodSiteAssignments", apps: "authmodAppAssignments", grants: "authmodAuthorityGrants", services: "authmodServicePrincipals", imports: "authmodImports", resolutions: "authmodImportResolutions", audits: "authmodAccessAudit" } as const;
async function readAll<T>(name: string) { return (await db.collection(name).get()).docs.map(document => document.data() as T); }
type CanonicalOploc = { canonicalId?: string; entityType?: string; lifecycleStatus?: string; publicationStatus?: string; record?: Record<string, unknown> };
function activeOploc(record: CanonicalOploc, oplocId: string) { return record.entityType === "OPLOC" && record.canonicalId === oplocId && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active"; }
function save<T extends { version: number }>(name: string, id: string, value: T, expectedVersion?: number) {
  return db.runTransaction(async transaction => { const ref = db.collection(name).doc(id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); });
}
export class FirestoreAuthModRepository implements AuthModRepository {
  async getIdentity(id: string) { const snapshot = await db.collection(collections.identities).doc(id).get(); return snapshot.exists ? snapshot.data() as AuthIdentity : undefined; }
  async listIdentities() { return readAll<AuthIdentity>(collections.identities); }
  async findIdentityByExternal(provider: string, uid: string) { const snapshot = await db.collection(collections.identities).where("externalProvider", "==", provider).where("externalUid", "==", uid).limit(1).get(); return snapshot.empty ? undefined : snapshot.docs[0].data() as AuthIdentity; }
  async findIdentityByEmail(email: string) { const snapshot = await db.collection(collections.identities).where("normalizedEmail", "==", email.trim().toLowerCase()).limit(1).get(); return snapshot.empty ? undefined : snapshot.docs[0].data() as AuthIdentity; }
  async findIdentityByLegend(legendId: string) { const snapshot = await db.collection(collections.identities).where("legendId", "==", legendId).limit(1).get(); return snapshot.empty ? undefined : snapshot.docs[0].data() as AuthIdentity; }
  async saveIdentity(value: AuthIdentity, expectedVersion?: number) { await save(collections.identities, value.id, value, expectedVersion); }
  async saveIdentityWithAudit(value: AuthIdentity, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.identities).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); }
  async listApplications() { return readAll<ApplicationRegistryEntry>(collections.applications); }
  async getApplication(appId: string) { const snapshot = await db.collection(collections.applications).doc(appId).get(); return snapshot.exists ? snapshot.data() as ApplicationRegistryEntry : undefined; }
  async saveApplication(value: ApplicationRegistryEntry, expectedVersion?: number) { await save(collections.applications, value.appId, value, expectedVersion); }
  async listActiveOplocs() { const records = await readAll<CanonicalOploc>("integrationHubCanonical"); return records.filter(record => record.entityType === "OPLOC" && record.canonicalId && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active").map(record => ({ id: record.canonicalId!, label: String(record.record?.approvedName || record.canonicalId), active: true })); }
  async getActiveOploc(oplocId: string) { const snapshot = await db.collection("integrationHubCanonical").where("canonicalId", "==", oplocId).where("entityType", "==", "OPLOC").limit(1).get(); const record = snapshot.empty ? undefined : snapshot.docs[0].data() as CanonicalOploc; return record && activeOploc(record, oplocId) ? { id: oplocId, label: String(record.record?.approvedName || oplocId), active: true } : undefined; }
  async listSiteAssignments(identityId: string) { const snapshot = await db.collection(collections.sites).where("identityId", "==", identityId).get(); return snapshot.docs.map(document => document.data() as SiteAssignment); }
  async getSiteAssignment(id: string) { const snapshot = await db.collection(collections.sites).doc(id).get(); return snapshot.exists ? snapshot.data() as SiteAssignment : undefined; }
  async saveSiteAssignment(value: SiteAssignment, expectedVersion?: number) { await save(collections.sites, value.id, value, expectedVersion); }
  async saveSiteAssignmentWithAudit(value: SiteAssignment, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.sites).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); }
  async listAppAssignments(identityId: string) { const snapshot = await db.collection(collections.apps).where("identityId", "==", identityId).get(); return snapshot.docs.map(document => document.data() as AppAssignment); }
  async getAppAssignment(id: string) { const snapshot = await db.collection(collections.apps).doc(id).get(); return snapshot.exists ? snapshot.data() as AppAssignment : undefined; }
  async saveAppAssignment(value: AppAssignment, expectedVersion?: number) { await save(collections.apps, value.id, value, expectedVersion); }
  async listAuthorityGrants(subjectId: string, subjectType?: "human" | "service") { const query = subjectType ? db.collection(collections.grants).where("subjectId", "==", subjectId).where("subjectType", "==", subjectType) : db.collection(collections.grants).where("subjectId", "==", subjectId); const snapshot = await query.get(); return snapshot.docs.map(document => document.data() as AuthorityGrant); }
  async saveAuthorityGrant(value: AuthorityGrant, expectedVersion?: number) { await save(collections.grants, value.id, value, expectedVersion); }
  async saveAuthorityGrantWithAudit(value: AuthorityGrant, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.grants).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); }
  async saveStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    await db.runTransaction(async transaction => {
      const assignmentRef = db.collection(collections.apps).doc(input.assignment.id);
      const assignmentSnapshot = await transaction.get(assignmentRef);
      assertExpectedVersion(assignmentSnapshot.exists ? Number(assignmentSnapshot.data()?.version) : undefined, input.expectedAssignmentVersion);
      transaction.set(assignmentRef, input.assignment as unknown as DocumentData);
      for (const grant of input.grants) transaction.set(db.collection(collections.grants).doc(grant.id), grant as unknown as DocumentData);
      if (input.audit) transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData);
    });
  }
  async revokeStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    await db.runTransaction(async transaction => {
      const assignmentRef = db.collection(collections.apps).doc(input.assignment.id); const snapshot = await transaction.get(assignmentRef);
      assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, input.expectedAssignmentVersion);
      transaction.set(assignmentRef, input.assignment as unknown as DocumentData);
      for (const grant of input.grants) transaction.set(db.collection(collections.grants).doc(grant.id), grant as unknown as DocumentData);
      if (input.audit) transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData);
    });
  }
  async getServicePrincipal(id: string) { const snapshot = await db.collection(collections.services).doc(id).get(); return snapshot.exists ? snapshot.data() as ServicePrincipal : undefined; }
  async listServicePrincipals() { return readAll<ServicePrincipal>(collections.services); }
  async saveServicePrincipal(value: ServicePrincipal, expectedVersion?: number) { await save(collections.services, value.id, value, expectedVersion); }
  async saveServicePrincipalWithAudit(value: ServicePrincipal, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.services).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); }
  async getImport(id: string) { const snapshot = await db.collection(collections.imports).doc(id).get(); return snapshot.exists ? snapshot.data() as ImportRecord : undefined; }
  async saveImport(value: ImportRecord, expectedVersion?: number) { await save(collections.imports, value.id, value, expectedVersion); }
  async saveImportResolution(value: ImportRowResolution, expectedVersion?: number) { await save(collections.resolutions, value.id, value, expectedVersion); }
  async listImportResolutions(importId: string) { const snapshot = await db.collection(collections.resolutions).where("importId", "==", importId).get(); return snapshot.docs.map(document => document.data() as ImportRowResolution); }
  async appendAudit(event: AccessAuditEvent) { await db.collection(collections.audits).doc(event.id).create(event); }
}
