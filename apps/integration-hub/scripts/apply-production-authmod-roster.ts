/**
 * Applies a REVIEWED production access roster to AUTHMOD. DRY RUN unless --execute is passed.
 *
 * Usage (from apps/integration-hub, application-default credentials for fika-os):
 *   FIKA_RUNTIME_MODE=production FIREBASE_PROJECT_ID=fika-os \
 *   npm run authmod:roster:production -- --roster production-roster.json --actor-email admin@fikacatering.com [--execute]
 *
 * Roster file (you author and approve it; nothing here invents users or permissions):
 *   { "users": [ { "email": "person@fikacatering.com", "identityKind": "person" | "operational", "apps": ["cpu-production"], "sites": ["oploc:..."] } ] }
 *
 * Rules: a user is only processed if a PRODUCTION Firebase Auth user already exists for the email (they have signed in once);
 * otherwise they are reported as NOT_SIGNED_IN_YET and skipped. Identities are reconciled by email, never by a staging UID.
 * The acting admin must already exist as an AUTHMOD administrator (see bootstrap-production-authmod.ts). Sites must be active
 * OPLOCs in production (migrate the Hub reference data first). Existing grants are reported, not duplicated.
 */
import { readFileSync } from "node:fs";
import { auth } from "../lib/firebase-admin";
import { FirestoreAuthModRepository } from "../lib/authmod-core";
import { assignSite, createAuthIdentity, grantStandardApplicationAccess, hasAuthmodAdmin } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";
import { getFikaRuntimeConfig } from "../lib/runtime-config";

type RosterUser = { email: string; identityKind?: "person" | "operational"; apps?: string[]; sites?: string[] };
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1]?.trim() : undefined; };
const rosterPath = value("--roster");
const actorEmail = value("--actor-email")?.toLowerCase();
const execute = args.includes("--execute");
if (!rosterPath || !actorEmail) throw new Error("Provide --roster <file> and --actor-email <existing AUTHMOD administrator>.");
const runtime = getFikaRuntimeConfig();
if (runtime.mode !== "production" || runtime.projectId !== "fika-os") throw new Error("This command is restricted to FIKA production project fika-os.");
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Refusing emulator configuration.");

const roster = JSON.parse(readFileSync(rosterPath, "utf8")) as { users: RosterUser[] };
if (!Array.isArray(roster.users) || !roster.users.length) throw new Error("The roster has no users.");
const repository = new FirestoreAuthModRepository();
const adminIdentity = await repository.findIdentityByEmail(actorEmail);
if (!adminIdentity || !(await hasAuthmodAdmin(repository, adminIdentity.id))) throw new Error("The acting user is not an existing AUTHMOD administrator in production.");
const actor: AuthPrincipal = { type: "interactive", id: adminIdentity.id, displayName: adminIdentity.displayName, email: adminIdentity.normalizedEmail, identityKind: "person" };

const report: Array<Record<string, unknown>> = [];
for (const entry of roster.users) {
  const email = entry.email.trim().toLowerCase();
  let user;
  try { user = await auth.getUserByEmail(email); } catch { report.push({ email, status: "NOT_SIGNED_IN_YET", detail: "no production Firebase Auth user; skipped" }); continue; }
  const existing = await repository.findIdentityByEmail(email);
  if (existing && (existing.externalProvider !== "firebase" || existing.externalUid !== user.uid)) { report.push({ email, status: "CONFLICT", detail: "email already linked to a different identity; resolve in AUTHMOD review" }); continue; }
  const row: Record<string, unknown> = { email, identity: existing ? "exists" : "would-create", apps: entry.apps || [], sites: entry.sites || [], applied: false };
  if (execute) {
    const identity = existing || await createAuthIdentity(repository, { actor, displayName: user.displayName?.trim() || email, email, externalProvider: "firebase", externalUid: user.uid, identityKind: entry.identityKind || "person", provenance: "migration" });
    row.identityId = identity.id; const results: string[] = [];
    for (const appId of entry.apps || []) { try { await grantStandardApplicationAccess(repository, { identityId: identity.id, appId, actor, reason: "Reviewed production launch access." }); results.push(`app:${appId}:granted`); } catch (error) { results.push(`app:${appId}:${(error as { status?: number }).status === 409 ? "already" : "FAILED " + (error as Error).message}`); } }
    for (const oplocId of entry.sites || []) { try { await assignSite(repository, { identityId: identity.id, oplocId, actor, reason: "Reviewed production launch access." }); results.push(`site:${oplocId}:assigned`); } catch (error) { results.push(`site:${oplocId}:${(error as { status?: number }).status === 409 ? "already" : "FAILED " + (error as Error).message}`); } }
    row.applied = true; row.results = results;
  }
  report.push(row);
}
console.log(JSON.stringify({ projectId: runtime.projectId, mode: execute ? "EXECUTE" : "DRY_RUN", actor: actorEmail, report }, null, 2));
