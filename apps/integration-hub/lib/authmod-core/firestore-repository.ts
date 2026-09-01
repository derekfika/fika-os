import type { DocumentData } from "firebase-admin/firestore";
import { db } from "../firebase-admin";
import type { AccessAuditEvent, AppAssignment, ApplicationRegistryEntry, AuditPage, AuthIdentity, AuthorityGrant, CustodianAssignment, DelegationRecord, ImportRecord, ImportRowResolution, LegendReference, ServicePrincipal, SiteAssignment } from "./model";
import { assertExpectedVersion, AuthModStoreUnavailable, type AuthModRepository, type OplocReference } from "./repository";
import { isTerminatedLegend } from "../connection-rules";
import type { CanonicalRecord } from "../types";
import { canonicalDocumentId, listActiveCanonicalOplocs } from "../canonical-oplocs";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { cachedAuthmodReference, invalidateAuthmodReferenceCaches } from "../authmod-reference-cache";
import { invalidateAuthmodAdmissionCache } from "../authmod-admission-cache";
const collections = { identities: "authmodIdentities", custodians: "authmodCustodianAssignments", applications: "authmodApplications", sites: "authmodSiteAssignments", apps: "authmodAppAssignments", grants: "authmodAuthorityGrants", delegations: "authmodDelegations", services: "authmodServicePrincipals", imports: "authmodImports", resolutions: "authmodImportResolutions", audits: "authmodAccessAudit" } as const;
const REFERENCE_CACHE_SCOPE = "global";
const firestoreResource = (collection: string) => `Firestore database (default), collection ${collection}`;
export function translateAuthmodFirestoreError(error: unknown, operation: string, collection: string) {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code || "");
  const message = String(candidate.message || "");
  if (code === "5" || code.toUpperCase().includes("NOT_FOUND") || message.toUpperCase().includes("NOT_FOUND")) {
    console.error("AUTHMOD Firestore resource unavailable", { operation, resource: firestoreResource(collection), errorCode: code || "NOT_FOUND" });
    return new AuthModStoreUnavailable("AUTHMOD staging authorization storage is unavailable. Contact an administrator to verify the staging Firestore database and bootstrap.", "AUTHMOD_STORE_RESOURCE_NOT_FOUND");
  }
  return error;
}
async function firestoreRead<T>(operation: string, collection: string, read: () => Promise<T>) {
  try {
    const result = await read();
    const value = result as T & { exists?: boolean; size?: number; docs?: unknown[] };
    const documents = typeof value.size === "number" ? value.size : Array.isArray(value.docs) ? value.docs.length : value.exists ? 1 : 0;
    recordDataAccess({ app: "integration-hub", operation: `authmod.${operation}`, source: "FIRESTORE", documents });
    return result;
  } catch (error) { throw translateAuthmodFirestoreError(error, operation, collection); }
}
function recordAuthmodReadBudget(operation: string, reads: Record<string, number>) {
  if (process.env.AUTHMOD_READ_BUDGET === "1") console.info("AUTHMOD read budget", { operation, reads });
}
async function readAll<T>(name: string) { return (await firestoreRead("readAll", name, () => db.collection(name).get())).docs.map(document => document.data() as T); }
type CanonicalOploc = { canonicalId?: string; entityType?: string; lifecycleStatus?: string; publicationStatus?: string; record?: Record<string, unknown> };
function activeOploc(record: CanonicalOploc, oplocId: string) { return record.entityType === "OPLOC" && record.canonicalId === oplocId && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active"; }
async function save<T extends { version: number }>(name: string, id: string, value: T, expectedVersion?: number) {
  await db.runTransaction(async transaction => { const ref = db.collection(name).doc(id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); });
  invalidateAuthmodReferenceCaches();
  invalidateAuthmodAdmissionCache();
}
export class FirestoreAuthModRepository implements AuthModRepository {
  constructor(private readonly cacheScope = "unscoped") {}
  async getIdentity(id: string) { const snapshot = await firestoreRead("getIdentity", collections.identities, () => db.collection(collections.identities).doc(id).get()); return snapshot.exists ? snapshot.data() as AuthIdentity : undefined; }
  async listIdentities() { return readAll<AuthIdentity>(collections.identities); }
  async listLegendReferences(search = "", limit = 100) { const references = await cachedAuthmodReference({ scope: REFERENCE_CACHE_SCOPE, name: "listLegendReferences", documents: value => value.length, load: async () => { const [legendSnapshot, employmentSnapshot] = await Promise.all([firestoreRead("listLegendReferences", "integrationHubCanonical", () => db.collection("integrationHubCanonical").where("entityType", "==", "Legend").get()), firestoreRead("listLegendReferences", "integrationHubCanonical", () => db.collection("integrationHubCanonical").where("entityType", "==", "Employment").get())]); const legends = legendSnapshot.docs.map(document => document.data() as CanonicalRecord); const employments = employmentSnapshot.docs.map(document => document.data() as CanonicalRecord); recordAuthmodReadBudget("listLegendReferences", { legends: legendSnapshot.size, employments: employmentSnapshot.size }); return legends.filter(value => value.canonicalId && value.lifecycleStatus !== "archived" && !isTerminatedLegend(value, employments)).map(value => ({ id: value.canonicalId!, label: String(value.record.displayName || value.record.preferredName || value.canonicalId), active: true })); } }); const needle = search.trim().toLowerCase(); return references.filter(value => !needle || value.label.toLowerCase().includes(needle)).slice(0, Math.min(limit, 1000)); }
  async findIdentityByExternal(provider: string, uid: string) { return (await this.findIdentitiesByExternal(provider, uid, 1))[0]; }
  async findIdentitiesByExternal(provider: string, uid: string, limit = 2) { const snapshot = await firestoreRead("findIdentitiesByExternal", collections.identities, () => db.collection(collections.identities).where("externalProvider", "==", provider).where("externalUid", "==", uid).limit(Math.min(limit, 10)).get()); return snapshot.docs.map(document => document.data() as AuthIdentity); }
  async findIdentityByEmail(email: string) { return (await this.findIdentitiesByEmail(email, 1))[0]; }
  async findIdentitiesByEmail(email: string, limit = 2) { const snapshot = await firestoreRead("findIdentitiesByEmail", collections.identities, () => db.collection(collections.identities).where("normalizedEmail", "==", email.trim().toLowerCase()).limit(Math.min(limit, 10)).get()); return snapshot.docs.map(document => document.data() as AuthIdentity); }
  async findIdentityByLegend(legendId: string) { const snapshot = await firestoreRead("findIdentityByLegend", collections.identities, () => db.collection(collections.identities).where("legendId", "==", legendId).limit(1).get()); return snapshot.empty ? undefined : snapshot.docs[0].data() as AuthIdentity; }
  async saveIdentity(value: AuthIdentity, expectedVersion?: number) { await save(collections.identities, value.id, value, expectedVersion); }
  async saveIdentityWithAudit(value: AuthIdentity, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.identities).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async listCustodianAssignments(operationalIdentityId: string) { const snapshot = await firestoreRead("listCustodianAssignments", collections.custodians, () => db.collection(collections.custodians).where("operationalIdentityId", "==", operationalIdentityId).get()); return snapshot.docs.map(document => document.data() as CustodianAssignment); }
  async saveCustodianHandover(input: { prior?: CustodianAssignment; next: CustodianAssignment; audit: AccessAuditEvent; expectedPriorVersion?: number }) { await db.runTransaction(async transaction => { const priorRef = input.prior ? db.collection(collections.custodians).doc(input.prior.id) : undefined; const priorSnapshot = priorRef ? await transaction.get(priorRef) : undefined; assertExpectedVersion(priorSnapshot?.exists ? Number(priorSnapshot.data()?.version) : undefined, input.expectedPriorVersion); if (priorRef) transaction.set(priorRef, input.prior as unknown as DocumentData); transaction.set(db.collection(collections.custodians).doc(input.next.id), input.next as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async listApplications() { return cachedAuthmodReference({ scope: REFERENCE_CACHE_SCOPE, name: "listApplications", documents: value => value.length, load: () => readAll<ApplicationRegistryEntry>(collections.applications) }); }
  async getApplication(appId: string) { const snapshot = await firestoreRead("getApplication", collections.applications, () => db.collection(collections.applications).doc(appId).get()); return snapshot.exists ? snapshot.data() as ApplicationRegistryEntry : undefined; }
  async saveApplication(value: ApplicationRegistryEntry, expectedVersion?: number) { await save(collections.applications, value.appId, value, expectedVersion); }
  async listActiveOplocs() { return cachedAuthmodReference({ scope: REFERENCE_CACHE_SCOPE, name: "listActiveOplocs", documents: value => value.length, load: async () => { const records = await listActiveCanonicalOplocs(); return records.map(record => ({ id: record.canonicalId!, label: String(record.record?.approvedName || record.canonicalId), active: true })); } }); }
  async getActiveOploc(oplocId: string) { const snapshot = await firestoreRead("getActiveOploc", "integrationHubCanonical", () => db.collection("integrationHubCanonical").doc(canonicalDocumentId(oplocId)).get()); const record = snapshot.exists ? snapshot.data() as CanonicalOploc : undefined; return record && activeOploc(record, oplocId) ? { id: oplocId, label: String(record.record?.approvedName || oplocId), active: true } : undefined; }
  async listSiteAssignments(identityId: string) { const snapshot = await firestoreRead("listSiteAssignments", collections.sites, () => db.collection(collections.sites).where("identityId", "==", identityId).get()); return snapshot.docs.map(document => document.data() as SiteAssignment); }
  async getSiteAssignment(id: string) { const snapshot = await firestoreRead("getSiteAssignment", collections.sites, () => db.collection(collections.sites).doc(id).get()); return snapshot.exists ? snapshot.data() as SiteAssignment : undefined; }
  async saveSiteAssignment(value: SiteAssignment, expectedVersion?: number) { await save(collections.sites, value.id, value, expectedVersion); }
  async saveSiteAssignmentWithAudit(value: SiteAssignment, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.sites).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async listAppAssignments(identityId: string) { const snapshot = await firestoreRead("listAppAssignments", collections.apps, () => db.collection(collections.apps).where("identityId", "==", identityId).get()); return snapshot.docs.map(document => document.data() as AppAssignment); }
  async getAppAssignment(id: string) { const snapshot = await firestoreRead("getAppAssignment", collections.apps, () => db.collection(collections.apps).doc(id).get()); return snapshot.exists ? snapshot.data() as AppAssignment : undefined; }
  async saveAppAssignment(value: AppAssignment, expectedVersion?: number) { await save(collections.apps, value.id, value, expectedVersion); }
  async listAuthorityGrants(subjectId: string, subjectType?: "interactive" | "service") { const query = subjectType ? db.collection(collections.grants).where("subjectId", "==", subjectId).where("subjectType", "==", subjectType) : db.collection(collections.grants).where("subjectId", "==", subjectId); const snapshot = await firestoreRead("listAuthorityGrants", collections.grants, () => query.get()); return snapshot.docs.map(document => document.data() as AuthorityGrant); }
  async saveAuthorityGrant(value: AuthorityGrant, expectedVersion?: number) { await save(collections.grants, value.id, value, expectedVersion); }
  async saveAuthorityGrantWithAudit(value: AuthorityGrant, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.grants).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async getDelegation(id: string) { const snapshot = await firestoreRead("getDelegation", collections.delegations, () => db.collection(collections.delegations).doc(id).get()); return snapshot.exists ? snapshot.data() as DelegationRecord : undefined; }
  async listDelegations(delegateId?: string) { const query = delegateId ? db.collection(collections.delegations).where("delegateId", "==", delegateId) : db.collection(collections.delegations); const snapshot = await firestoreRead("listDelegations", collections.delegations, () => query.get()); return snapshot.docs.map(document => document.data() as DelegationRecord); }
  async saveDelegationWithGrant(input: { delegation: DelegationRecord; grant: AuthorityGrant; audit: AccessAuditEvent }) { await db.runTransaction(async transaction => { transaction.create(db.collection(collections.delegations).doc(input.delegation.id), input.delegation as unknown as DocumentData); transaction.create(db.collection(collections.grants).doc(input.grant.id), input.grant as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async saveStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    await db.runTransaction(async transaction => {
      const assignmentRef = db.collection(collections.apps).doc(input.assignment.id);
      const assignmentSnapshot = await transaction.get(assignmentRef);
      assertExpectedVersion(assignmentSnapshot.exists ? Number(assignmentSnapshot.data()?.version) : undefined, input.expectedAssignmentVersion);
      transaction.set(assignmentRef, input.assignment as unknown as DocumentData);
      for (const grant of input.grants) transaction.set(db.collection(collections.grants).doc(grant.id), grant as unknown as DocumentData);
      if (input.audit) transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData);
    });
    invalidateAuthmodReferenceCaches();
    invalidateAuthmodAdmissionCache();
  }
  async revokeStandardApplicationBundle(input: { assignment: AppAssignment; grants: AuthorityGrant[]; audit?: AccessAuditEvent; expectedAssignmentVersion?: number }) {
    await db.runTransaction(async transaction => {
      const assignmentRef = db.collection(collections.apps).doc(input.assignment.id); const snapshot = await transaction.get(assignmentRef);
      assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, input.expectedAssignmentVersion);
      transaction.set(assignmentRef, input.assignment as unknown as DocumentData);
      for (const grant of input.grants) transaction.set(db.collection(collections.grants).doc(grant.id), grant as unknown as DocumentData);
      if (input.audit) transaction.create(db.collection(collections.audits).doc(input.audit.id), input.audit as unknown as DocumentData);
    });
    invalidateAuthmodReferenceCaches();
    invalidateAuthmodAdmissionCache();
  }
  async getServicePrincipal(id: string) { const snapshot = await firestoreRead("getServicePrincipal", collections.services, () => db.collection(collections.services).doc(id).get()); return snapshot.exists ? snapshot.data() as ServicePrincipal : undefined; }
  async listServicePrincipals() { return readAll<ServicePrincipal>(collections.services); }
  async saveServicePrincipal(value: ServicePrincipal, expectedVersion?: number) { await save(collections.services, value.id, value, expectedVersion); }
  async saveServicePrincipalWithAudit(value: ServicePrincipal, audit: AccessAuditEvent, expectedVersion?: number) { await db.runTransaction(async transaction => { const ref = db.collection(collections.services).doc(value.id); const snapshot = await transaction.get(ref); assertExpectedVersion(snapshot.exists ? Number(snapshot.data()?.version) : undefined, expectedVersion); transaction.set(ref, value as unknown as DocumentData); transaction.create(db.collection(collections.audits).doc(audit.id), audit as unknown as DocumentData); }); invalidateAuthmodReferenceCaches(); invalidateAuthmodAdmissionCache(); }
  async getImport(id: string) { const snapshot = await db.collection(collections.imports).doc(id).get(); return snapshot.exists ? snapshot.data() as ImportRecord : undefined; }
  async listImports(limit = 100) { const snapshot = await firestoreRead("listImports", collections.imports, () => db.collection(collections.imports).orderBy("uploadedAt", "desc").limit(Math.min(limit, 200)).get()); return snapshot.docs.map(document => document.data() as ImportRecord); }
  async saveImport(value: ImportRecord, expectedVersion?: number) { await save(collections.imports, value.id, value, expectedVersion); }
  async saveImportResolution(value: ImportRowResolution, expectedVersion?: number) { await save(collections.resolutions, value.id, value, expectedVersion); }
  async listImportResolutions(importId: string) { const snapshot = await firestoreRead("listImportResolutions", collections.resolutions, () => db.collection(collections.resolutions).where("importId", "==", importId).get()); return snapshot.docs.map(document => document.data() as ImportRowResolution); }
  async listAuditEvents(input: { limit?: number; cursor?: string; actorId?: string; targetId?: string } = {}): Promise<AuditPage> { const pageSize = Math.min(input.limit || 50, 200); let query: FirebaseFirestore.Query = db.collection(collections.audits); if (input.actorId) query = query.where("actorPrincipalId", "==", input.actorId); if (input.targetId) query = query.where("targetId", "==", input.targetId); if (input.cursor) query = query.where("timestamp", "<", input.cursor); query = query.orderBy("timestamp", "desc").limit(pageSize); const snapshot = await query.get(); const events = snapshot.docs.map(document => document.data() as AccessAuditEvent); return { events, ...(events.length === pageSize ? { nextCursor: events.at(-1)?.timestamp } : {}) }; }
  async appendAudit(event: AccessAuditEvent) { await db.collection(collections.audits).doc(event.id).create(event); }
}
