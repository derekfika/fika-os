/**
 * One-time, deliberate AUTHMOD bootstrap for the alpha staging project.
 *
 * Usage:
 *   FIKA_RUNTIME_MODE=staging FIREBASE_PROJECT_ID=fika-os-dev \
 *   npm run authmod:bootstrap:staging -- --email person@fikacatering.com
 *
 * This does not import emulator data. It creates only the V1 application
 * registry, the nominated Firebase person identity, its AUTHMOD admin grant,
 * and Integration Hub application access.
 */
import { auth } from "../lib/firebase-admin";
import { FirestoreAuthModRepository } from "../lib/authmod-core";
import { createAuthIdentity, ensureV1ApplicationRegistry, grantAuthmodAdmin, grantStandardApplicationAccess } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";
import { getFikaRuntimeConfig } from "../lib/runtime-config";

const email = process.argv[process.argv.indexOf("--email") + 1]?.trim().toLowerCase();
if (!email || email.startsWith("--")) throw new Error("Provide exactly one --email for an existing Firebase Auth user.");
const runtime = getFikaRuntimeConfig();
if (runtime.mode !== "staging" || runtime.projectId !== "fika-os-dev") throw new Error("This command is restricted to FIKA staging project fika-os-dev.");
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Staging bootstrap refuses emulator configuration.");

const user = await auth.getUserByEmail(email);
const repository = new FirestoreAuthModRepository();
const existing = await repository.findIdentityByEmail(email);
const identity = existing || await createAuthIdentity(repository, {
  actor: { type: "service", id: "service:staging-authmod-bootstrap", displayName: "FIKA staging AUTHMOD bootstrap" },
  displayName: user.displayName?.trim() || email,
  email,
  externalProvider: "firebase",
  externalUid: user.uid,
  identityKind: "person",
  provenance: "migration",
});
if (existing && (existing.externalProvider !== "firebase" || existing.externalUid !== user.uid)) throw new Error("The nominated email is already linked to a different AUTHMOD identity; resolve it through AUTHMOD review.");
const actor: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: "person" };
const applications = await ensureV1ApplicationRegistry(repository, actor);
const grants = await repository.listAuthorityGrants(identity.id, "interactive");
if (!grants.some(value => value.appId === "integration-hub" && value.resource === "authmod" && value.action === "Administer" && value.status === "active")) await grantAuthmodAdmin(repository, { identityId: identity.id, actor, reason: "Explicit staging alpha bootstrap administrator." });
await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "integration-hub", actor, reason: "Explicit staging alpha Integration Hub access." });
console.log(JSON.stringify({ projectId: runtime.projectId, identityId: identity.id, email, createdIdentity: !existing, applicationsCreated: applications.map(value => value.appId), authmodAdmin: true, integrationHubAccess: true }, null, 2));
