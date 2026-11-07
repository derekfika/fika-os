import { isDeepStrictEqual } from "node:util";
import type { UserRecord } from "firebase-admin/auth";
import { auditEvent } from "./authmod-core/audit";
import {
  BEVERAGE_AUTHMOD_APP_ID, BEVERAGE_AUTHMOD_NORMAL_BUNDLE, BEVERAGE_AUTHMOD_NORMAL_RESOURCE, isEffectiveBeverageAccess,
} from "./authmod-core/beverage-admission";
import { FirestoreAuthModRepository } from "./authmod-core/firestore-repository";
import { idempotentId, normalizeEmail, type AccessAuditEvent, type ApplicationRegistryEntry } from "./authmod-core/model";
import { getAuthmodReferenceReadPackage, rebuildAuthmodReferenceReadPackage } from "./authmod-reference-read-package";
import { invalidateAuthmodAdmissionCache } from "./authmod-admission-cache";
import { invalidateAuthmodReferenceCaches } from "./authmod-reference-cache";
import { db } from "./firebase-admin";
import { bumpCacheDatasets } from "./integration-cache-server";

const application = {
  appId: BEVERAGE_AUTHMOD_APP_ID, displayName: "Beverage Innovation", enabled: true, launchVisible: false,
  scopeModel: "oploc", standardBundleId: BEVERAGE_AUTHMOD_NORMAL_BUNDLE, standardResource: BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
  standardActions: ["View"], version: 1, provenance: "migration",
} satisfies Omit<ApplicationRegistryEntry, "createdAt" | "updatedAt">;
const commandId = idempotentId("staging", BEVERAGE_AUTHMOD_APP_ID, "registry", "v1");
const auditId = idempotentId("application-registered", commandId);
const auditReason = "Owner-approved Beverage Innovation #115 staging scope: register the hidden View-only application.";
const denied = () => new Error("A uniquely bound, active person with direct AUTHMOD Administer authority is required.");

export function resolveBeverageRegistryOperator(
  google: { email?: unknown; email_verified?: unknown; sub?: unknown },
  firebase: Pick<UserRecord, "uid" | "email" | "emailVerified" | "disabled"> & {
    providerData: readonly Pick<UserRecord["providerData"][number], "providerId" | "uid">[];
  },
) {
  const email = typeof google.email === "string" ? normalizeEmail(google.email) : undefined;
  const googleProviders = firebase.providerData.filter(provider => provider.providerId === "google.com");
  if (!email || google.email_verified !== true || typeof google.sub !== "string" || !google.sub ||
      !firebase.uid || firebase.disabled || !firebase.emailVerified || normalizeEmail(firebase.email) !== email ||
      googleProviders.length !== 1 || googleProviders[0].uid !== google.sub) throw denied();
  return { uid: firebase.uid, email };
}

type RegistryOperator = ReturnType<typeof resolveBeverageRegistryOperator>;
type RegistryReceipt = AccessAuditEvent & { reason: string };

export async function provisionBeverageStagingRegistry(operator: RegistryOperator, execute: boolean) {
  const run = async (transaction: FirebaseFirestore.Transaction) => {
    const repository = new FirestoreAuthModRepository("beverage-staging-registry", undefined, transaction);
    const identities = await repository.findIdentitiesByExternal("firebase", operator.uid, 2);
    const identity = identities[0];
    const at = new Date();
    if (identities.length !== 1 || !identity?.id || identity.identityKind !== "person" ||
        identity.externalProvider !== "firebase" || identity.externalUid !== operator.uid ||
        identity.normalizedEmail !== operator.email || !isEffectiveBeverageAccess(identity, at)) throw denied();
    const grantId = idempotentId("authority", "interactive", identity.id, "integration-hub", "authmod", "Administer", "organisation");
    const grant = await repository.getAuthorityGrant(grantId);
    if (!grant || grant.id !== grantId || grant.subjectId !== identity.id || grant.subjectType !== "interactive" ||
        grant.appId !== "integration-hub" || grant.resource !== "authmod" || grant.action !== "Administer" ||
        grant.provenance !== "explicit-special-authority" || grant.scope.kind !== "organisation" || grant.scope.ids.length !== 0 ||
        grant.accessType === "delegated" || grant.delegationSourceGrantId || !isEffectiveBeverageAccess(grant, at)) throw denied();

    const appRef = db.collection("authmodApplications").doc(application.appId);
    const auditRef = db.collection("authmodAccessAudit").doc(auditId);
    const [appSnapshot, auditSnapshot] = await transaction.getAll(appRef, auditRef);
    if (appSnapshot.exists || auditSnapshot.exists) {
      const existing = appSnapshot.data() as ApplicationRegistryEntry | undefined;
      const receipt = auditSnapshot.data() as RegistryReceipt | undefined;
      if (!existing || !Number.isFinite(Date.parse(existing.createdAt)) ||
          !isDeepStrictEqual(existing, { ...application, createdAt: existing.createdAt, updatedAt: existing.createdAt }) ||
          !receipt || receipt.id !== auditId || receipt.idempotencyKey !== commandId ||
          receipt.targetType !== "ApplicationRegistry" || receipt.targetId !== application.appId ||
          receipt.action !== "application-registered" || receipt.outcome !== "committed" || receipt.reason !== auditReason ||
          !isDeepStrictEqual(receipt.afterState, existing)) {
        throw new Error("The existing Beverage registry or audit differs from this command. Review it without overwriting.");
      }
      return { status: "already-registered" as const, application: existing, auditId };
    }
    if (!execute) return { status: "planned" as const, application, auditId };
    const timestamp = at.toISOString();
    const value = { ...application, createdAt: timestamp, updatedAt: timestamp };
    const event = auditEvent({
      actor: { type: "interactive", id: identity.id, displayName: identity.displayName, identityKind: "person", email: operator.email },
      targetType: "ApplicationRegistry", targetId: application.appId, action: "application-registered",
      afterState: value, provenance: "migration", outcome: "committed", idempotencyKey: commandId,
    });
    transaction.create(appRef, value);
    const receipt: RegistryReceipt = { ...event, id: auditId, reason: auditReason };
    transaction.create(auditRef, receipt);
    bumpCacheDatasets(transaction, ["applications"], timestamp);
    return { status: "created" as const, application: value, auditId };
  };
  const result = execute ? await db.runTransaction(run) : await db.runTransaction(run, { readOnly: true });
  if (result.status === "created") {
    invalidateAuthmodReferenceCaches();
    invalidateAuthmodAdmissionCache();
  }
  return result;
}

export async function publishBeverageRegistryReferences(expected: ApplicationRegistryEntry) {
  const readCurrent = async () => (await getAuthmodReferenceReadPackage()).applications.find(app => app.appId === expected.appId);
  let current;
  try { current = await readCurrent(); }
  catch (error) {
    if (!["AUTHMOD_REFERENCE_PACKAGE_MISSING", "AUTHMOD_REFERENCE_PACKAGE_STALE"].includes(String((error as { code?: unknown }).code))) throw error;
    await rebuildAuthmodReferenceReadPackage();
    current = await readCurrent();
  }
  if (!isDeepStrictEqual(current, expected)) throw new Error("The current AUTHMOD reference package differs from the registered Beverage entry.");
}
