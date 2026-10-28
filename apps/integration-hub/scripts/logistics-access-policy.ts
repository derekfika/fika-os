/** Staging-only, audited repair of explicit desktop vehicle authority. Dry run by default. */
import { execFileSync } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createRequire } from "node:module";
import { getFikaRuntimeConfig } from "../lib/runtime-config";
import { isEffective } from "../lib/authmod-core/model";

function gcloud(args: string[]) {
  // All arguments are fixed below; credentials remain in memory and are never logged.
  return execFileSync(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "gcloud", process.platform === "win32" ? ["/d", "/s", "/c", `gcloud ${args.join(" ")}`] : args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const email = arg("--email")?.trim().toLowerCase();
const expectedVersion = Number(arg("--expected-version"));
const reason = arg("--reason")?.trim();
const execute = args.includes("--execute");
const runtime = getFikaRuntimeConfig();
const bucketName = "fika-os-dev-staging-read-packages-europe-west4";
if (runtime.mode !== "staging" || runtime.projectId !== "fika-os-dev" || process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error("Only the real fika-os-dev staging environment is permitted.");
if (!email || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !reason) throw Error("Supply --email, --expected-version and --reason. Default is read-only.");
process.env.FIKA_SNAPSHOT_BUCKET = bucketName;
const operatorEmail = gcloud(["config", "get-value", "account"]).toLowerCase();
// Use the auth client version used by the Firestore/GAX transport (v9 Headers contract).
const require = createRequire(import.meta.url);
const { GoogleAuth, OAuth2Client } = createRequire(require.resolve("google-gax"))("google-auth-library");
const oauth = new OAuth2Client();
oauth.setCredentials({ access_token: gcloud(["auth", "print-access-token", "--quiet"]), expiry_date: Date.now() + 30 * 60_000 });
const googleAuth = new GoogleAuth({ authClient: oauth, projectId: runtime.projectId });
// Reuse the existing authenticated Cloud SDK account through public Google client options.
const app = initializeApp({ projectId: runtime.projectId, storageBucket: bucketName });
getFirestore(app).settings({ ignoreUndefinedProperties: true, auth: googleAuth, preferRest: true });
getStorage(app).bucket(bucketName).storage.authClient.cachedCredential = oauth;
const { FirestoreAuthModRepository } = await import("../lib/authmod-core/firestore-repository");
const { grantAuthority, requireAuthmodAdmin, createAuthModEvaluationContext, resolvePermittedVehicleIds, resolveUserAccess } = await import("../lib/authmod-core/index");
const repository = new FirestoreAuthModRepository();
const operators = await repository.findIdentitiesByEmail(operatorEmail, 2);
const identities = await repository.findIdentitiesByEmail(email, 2);
if (operators.length !== 1 || identities.length !== 1) throw Error("Operator and target must each resolve to one existing identity.");
const operator = operators[0], identity = identities[0];
if (operator.status !== "active" || operator.externalProvider !== "firebase" || !operator.externalUid) throw Error("Operator must be an existing active Firebase-bound AUTHMOD administrator.");
if (identity.status !== "active" || identity.version !== expectedVersion || identity.externalProvider !== "firebase" || !identity.externalUid) throw Error("Target status, Firebase binding or expected version changed.");
const actor = { type: "interactive" as const, id: operator.id, displayName: operator.displayName, email: operator.normalizedEmail, identityKind: operator.identityKind };
await requireAuthmodAdmin(repository, actor);
const principal = { type: "interactive" as const, id: identity.id, displayName: identity.displayName, identityKind: identity.identityKind };
const assignments = await repository.listAppAssignments(identity.id);
if (!assignments.some(value => value.appId === "logistics" && isEffective(value))) throw Error("An explicit active Logistics application assignment is required.");
const beforeContext = createAuthModEvaluationContext(repository, principal);
if (!(await resolveUserAccess(repository, { principal, appId: "logistics" }, beforeContext)).allowed) throw Error("Target is not admitted to Logistics.");
const before = await resolvePermittedVehicleIds(repository, { principal }, beforeContext);
if (before.resolutionFailed) throw Error("Vehicle policy could not be resolved.");
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", project: runtime.projectId, operatorId: operator.id, identityId: identity.id, identityKind: identity.identityKind, fullAccess: identity.fullAccess, version: identity.version, before: before.permittedVehicleIds, proposed: { resource: "logistics.vehicle", action: "View", scope: { kind: "resource", ids: ["van1", "van2"] } } }));
if (execute) {
  const grants = await repository.listAuthorityGrants(identity.id, "interactive");
  const alreadyGranted = grants.some(value => value.appId === "logistics" && value.resource === "logistics.vehicle" && value.action === "View" && value.scope.kind === "resource" && ["van1", "van2"].every(id => value.scope.ids.includes(id)) && isEffective(value));
  if (!alreadyGranted) await grantAuthority(repository, { subjectId: identity.id, subjectType: "interactive", actor, appId: "logistics", resource: "logistics.vehicle", action: "View", scope: { kind: "resource", ids: ["van1", "van2"] }, reason });
  const after = await resolvePermittedVehicleIds(repository, { principal });
  const unchangedIdentity = await repository.getIdentity(identity.id);
  if (after.resolutionFailed || JSON.stringify(after.permittedVehicleIds) !== JSON.stringify(["van1", "van2"]) || JSON.stringify(unchangedIdentity) !== JSON.stringify(identity)) throw Error("Post-write policy/identity verification failed; inspect before any retry.");
  console.log(JSON.stringify({ result: alreadyGranted ? "already-granted" : "audited-grant-and-package-published", permittedVehicleIds: after.permittedVehicleIds, identityUnchanged: true }));
}
