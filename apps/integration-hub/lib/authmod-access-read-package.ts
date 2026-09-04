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
  if (!identity.exists) throw Object.assign(new Error("AUTHMOD identity is unavailable."), { status: 503, code: "AUTHMOD_IDENTITY_PACKAGE_MISSING" });
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
      throw Object.assign(new Error("AUTHMOD access package is missing or stale; rebuild it through the governed package operation."), { status: 503, code: !result ? "AUTHMOD_ACCESS_PACKAGE_MISSING" : "AUTHMOD_ACCESS_PACKAGE_STALE" });
    }
    entries.set(identityId, { version: head, value: validateAuthmodAccessReadPackage(result.value) });
    recordDataAccess({ app: "integration-hub", operation: "authmod.package.read", source: "SNAPSHOT", documents: result.manifest.recordCount, cacheHit: false, dataset: AUTHMOD_ACCESS_DATASET, packageVersion: result.manifest.packageVersion });
    return validateAuthmodAccessReadPackage(result.value);
  })();
  inFlight.set(identityId, promise);
  try { return await promise; } finally { if (inFlight.get(identityId) === promise) inFlight.delete(identityId); }
}

export function clearAuthmodAccessReadPackageCacheForTests() { entries.clear(); inFlight.clear(); }
