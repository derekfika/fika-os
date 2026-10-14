/**
 * One-time, deliberate AUTHMOD bootstrap for PRODUCTION (project fika-os). DRY RUN unless --execute is passed.
 *
 * Usage (from apps/integration-hub, with application-default credentials for fika-os):
 *   FIKA_RUNTIME_MODE=production FIREBASE_PROJECT_ID=fika-os \
 *   npm run authmod:bootstrap:production -- --email person@fikacatering.com            # dry run
 *   npm run authmod:bootstrap:production -- --email person@fikacatering.com --execute  # writes
 *
 * Prerequisite: the person has ALREADY signed in to PRODUCTION once, so a production Firebase Auth user (and UID) exists.
 * This tool never creates an Auth user, never copies staging identities/UIDs, and never guesses: if the email is not a
 * production Auth user it stops. It creates only the V1 application registry (idempotent), the nominated person identity
 * keyed by email, its AUTHMOD admin grant and Integration Hub application access. Everyone else is handled afterwards by
 * apply-production-authmod-roster.ts or the AUTHMOD UI.
 */
import { auth } from "../lib/firebase-admin";
import { FirestoreAuthModRepository } from "../lib/authmod-core";
import { createAuthIdentity, ensureV1ApplicationRegistry, grantAuthmodAdmin, grantStandardApplicationAccess } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";
import { getFikaRuntimeConfig } from "../lib/runtime-config";

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1]?.trim().toLowerCase();
const execute = args.includes("--execute");
if (!email || email.startsWith("--")) throw new Error("Provide exactly one --email for an existing PRODUCTION Firebase Auth user.");
const runtime = getFikaRuntimeConfig();
if (runtime.mode !== "production" || runtime.projectId !== "fika-os") throw new Error("This command is restricted to FIKA production project fika-os (FIKA_RUNTIME_MODE=production, FIREBASE_PROJECT_ID=fika-os).");
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Production bootstrap refuses emulator configuration.");

let user;
try { user = await auth.getUserByEmail(email); }
catch { console.log(JSON.stringify({ projectId: runtime.projectId, email, status: "NOT_SIGNED_IN_YET", detail: "No production Firebase Auth user exists for this email. Ask the person to sign in to production once, then re-run." }, null, 2)); process.exit(3); }

const repository = new FirestoreAuthModRepository();
const existing = await repository.findIdentityByEmail(email);
if (existing && (existing.externalProvider !== "firebase" || existing.externalUid !== user.uid)) throw new Error("The nominated email is already linked to a different AUTHMOD identity; resolve it through AUTHMOD review instead of rebinding it here.");
const plan = { projectId: runtime.projectId, email, firebaseUidPresent: Boolean(user.uid), identityExists: Boolean(existing), willCreateIdentity: !existing, willEnsureApplicationRegistry: true, willGrantAuthmodAdmin: true, willGrantIntegrationHubAccess: true, mode: execute ? "EXECUTE" : "DRY_RUN" };
if (!execute) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

const identity = existing || await createAuthIdentity(repository, {
  actor: { type: "service", id: "service:production-authmod-bootstrap", displayName: "FIKA production AUTHMOD bootstrap" },
  displayName: user.displayName?.trim() || email,
  email,
  externalProvider: "firebase",
  externalUid: user.uid,
  identityKind: "person",
  provenance: "migration",
});
const actor: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: "person" };
const applications = await ensureV1ApplicationRegistry(repository, actor);
const grants = await repository.listAuthorityGrants(identity.id, "interactive");
if (!grants.some((value) => value.appId === "integration-hub" && value.resource === "authmod" && value.action === "Administer" && value.status === "active")) await grantAuthmodAdmin(repository, { identityId: identity.id, actor, reason: "Explicit production launch bootstrap of the first AUTHMOD administrator." });
await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "integration-hub", actor, reason: "Explicit production launch Integration Hub access." });
console.log(JSON.stringify({ ...plan, identityId: identity.id, createdIdentity: !existing, applicationsEnsured: applications.map((value) => value.appId), authmodAdmin: true, integrationHubAccess: true }, null, 2));
