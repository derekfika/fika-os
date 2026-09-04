import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { oplocPackageStore } from "./oploc-read-package";
import type { AppAssignment, AuthIdentity, AuthorityGrant, CustodianAssignment, DelegationRecord, SiteAssignment } from "./authmod-core/model";

export const AUTHMOD_ACCESS_DATASET = "integration-hub/authmod-access";
export const authmodAccessManifestKey = (identityId: string) => `${AUTHMOD_ACCESS_DATASET}/${encodeURIComponent(identityId)}`;
export type AuthmodAccessReadPackage = {
  identity: AuthIdentity;
  appAssignments: AppAssignment[];
  siteAssignments: SiteAssignment[];
  authorityGrants: AuthorityGrant[];
  delegations: DelegationRecord[];
  custodians: CustodianAssignment[];
  securityVersion: number;
};

export function validateAuthmodAccessReadPackage(value: AuthmodAccessReadPackage) {
  if (!value || !value.identity?.id || !Number.isSafeInteger(value.securityVersion) || value.securityVersion < 0) throw Object.assign(new Error("AUTHMOD access package is invalid."), { status: 503, code: "AUTHMOD_ACCESS_PACKAGE_INVALID" });
  for (const field of ["appAssignments", "siteAssignments", "authorityGrants", "delegations", "custodians"] as const) if (!Array.isArray(value[field])) throw Object.assign(new Error(`AUTHMOD access package ${field} is invalid.`), { status: 503, code: "AUTHMOD_ACCESS_PACKAGE_INVALID" });
  return value;
}

const entries = new Map<string, { version: number; value: AuthmodAccessReadPackage }>();
const inFlight = new Map<string, Promise<AuthmodAccessReadPackage>>();

export async function readAuthmodAccessHead(identityId: string) {
  const snapshot = await db.collection("authmodAccessHeads").doc(identityId).get();
  recordDataAccess({ app: "integration-hub", operation: "authmod.package.head", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  return snapshot.exists ? Number(snapshot.data()?.version || 0) : 0;
}

export function bumpAuthmodAccessHead(transaction: FirebaseFirestore.Transaction, identityId: string, now = new Date().toISOString()) {
  const ref = db.collection("authmodAccessHeads").doc(identityId);
  transaction.set(ref, { version: Date.now(), updatedAt: now }, { merge: true });
}

export async function rebuildAuthmodAccessReadPackage(identityId: string): Promise<ReadPackageManifest> {
  const [identity, apps, sites, grants, delegations, custodians] = await Promise.all([
    db.collection("authmodIdentities").doc(identityId).get(),
    db.collection("authmodAppAssignments").where("identityId", "==", identityId).get(),
    db.collection("authmodSiteAssignments").where("identityId", "==", identityId).get(),
    db.collection("authmodAuthorityGrants").where("subjectId", "==", identityId).get(),
    db.collection("authmodDelegations").where("delegateId", "==", identityId).get(),
    db.collection("authmodCustodianAssignments").where("operationalIdentityId", "==", identityId).get(),
  ]);
  if (!identity.exists) throw Object.assign(new Error("AUTHMOD identity is unavailable."), { status: 403, code: "AUTHMOD_IDENTITY_NOT_FOUND" });
  if ((identity.data() as AuthIdentity).status !== "active") throw Object.assign(new Error("Inactive AUTHMOD identities cannot bootstrap an access package."), { status: 403, code: "AUTHMOD_IDENTITY_INACTIVE" });
  const securityVersion = await readAuthmodAccessHead(identityId);
  const value: AuthmodAccessReadPackage = {
    identity: identity.data() as AuthIdentity,
    appAssignments: apps.docs.map(value => value.data() as AppAssignment),
    siteAssignments: sites.docs.map(value => value.data() as SiteAssignment),
    authorityGrants: grants.docs.map(value => value.data() as AuthorityGrant),
    delegations: delegations.docs.map(value => value.data() as DelegationRecord),
    custodians: custodians.docs.map(value => value.data() as CustodianAssignment),
    securityVersion,
  };
  const store = oplocPackageStore();
  const previous = await store.getManifest(authmodAccessManifestKey(identityId));
  const encoded = encodeReadPackage(AUTHMOD_ACCESS_DATASET, (previous?.packageVersion || 0) + 1, value, apps.size + sites.size + grants.size + delegations.size + custodians.size + 1, { contractVersion: "integration-hub.authmod-access.v1", sourceVersion: `authmod-security:${securityVersion}`, scope: identityId });
  const manifest = await publishReadPackage<AuthmodAccessReadPackage>(store, authmodAccessManifestKey(identityId), encoded);
  entries.set(identityId, { version: securityVersion, value });
  recordDataAccess({ app: "integration-hub", operation: "authmod.package.rebuild", source: "FIRESTORE", documents: apps.size + sites.size + grants.size + delegations.size + custodians.size + 1, cacheHit: false });
  return manifest;
}

export async function bootstrapAuthmodAccessPackage(identityId: string) {
  return rebuildAuthmodAccessReadPackage(identityId);
}

export async function bootstrapActiveAuthmodAccessPackages() {
  const snapshot = await db.collection("authmodIdentities").where("status", "==", "active").get();
  const identities = snapshot.docs.map(document => String(document.id));
  const results: Array<{ identityId: string; status: "published" | "failed"; error?: string }> = [];
  for (const identityId of identities) {
    try { await bootstrapAuthmodAccessPackage(identityId); results.push({ identityId, status: "published" }); }
    catch (error) { results.push({ identityId, status: "failed", error: error instanceof Error ? error.message : "Bootstrap failed." }); }
  }
  return { attempted: identities.length, published: results.filter(value => value.status === "published").length, failed: results.filter(value => value.status === "failed").length, results };
}

export async function getAuthmodAccessReadPackage(identityId: string) {
  const head = await readAuthmodAccessHead(identityId);
  const cached = entries.get(identityId);
  if (cached && cached.version === head) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.package.cache", source: "APP_CACHE", documents: 0, cacheHit: true, cacheResult: "HIT" });
    return cached.value;
  }
  const pending = inFlight.get(identityId);
  if (pending) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.package.cache", source: "APP_CACHE", documents: 0, cacheHit: true, cacheResult: "IN_FLIGHT_JOIN" });
    return pending;
  }
  const promise = (async () => {
    const result = await retrieveReadPackage<AuthmodAccessReadPackage>(oplocPackageStore(), authmodAccessManifestKey(identityId));
    if (!result || result.manifest.sourceVersion !== `authmod-security:${head}`) {
      if (!result) {
        await bootstrapAuthmodAccessPackage(identityId);
        const bootstrapped = await retrieveReadPackage<AuthmodAccessReadPackage>(oplocPackageStore(), authmodAccessManifestKey(identityId));
        if (!bootstrapped) throw Object.assign(new Error("AUTHMOD access package bootstrap did not publish a package."), { status: 503, code: "AUTHMOD_ACCESS_PACKAGE_MISSING" });
        const value = validateAuthmodAccessReadPackage(bootstrapped.value);
        entries.set(identityId, { version: head, value });
        recordDataAccess({ app: "integration-hub", operation: "authmod.package.bootstrap", source: "FIRESTORE", documents: bootstrapped.manifest.recordCount, cacheHit: false, cacheResult: "MISS" });
        return value;
      }
      throw Object.assign(new Error("AUTHMOD access package is stale; rebuild it through the governed package operation."), { status: 503, code: "AUTHMOD_ACCESS_PACKAGE_STALE" });
    }
    entries.set(identityId, { version: head, value: validateAuthmodAccessReadPackage(result.value) });
    recordDataAccess({ app: "integration-hub", operation: "authmod.package.read", source: "SNAPSHOT", documents: result.manifest.recordCount, cacheHit: false, dataset: AUTHMOD_ACCESS_DATASET, packageVersion: result.manifest.packageVersion });
    return validateAuthmodAccessReadPackage(result.value);
  })();
  inFlight.set(identityId, promise);
  try { return await promise; } finally { if (inFlight.get(identityId) === promise) inFlight.delete(identityId); }
}

export function clearAuthmodAccessReadPackageCacheForTests() { entries.clear(); inFlight.clear(); }
