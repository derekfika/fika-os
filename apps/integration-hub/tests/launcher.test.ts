import test from "node:test";
import assert from "node:assert/strict";
import { appHref, buildLauncher } from "../lib/launcher";
import { MemoryAuthModRepository } from "../lib/authmod-core";
import { V1_APPLICATIONS } from "../lib/authmod-core/model";
import { createAuthIdentity } from "../lib/authmod-core/identity";
import { assignSite, grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { grantAuthmodAdmin } from "../lib/authmod-core";
import { ensureV1ApplicationRegistry } from "../lib/authmod-core/registry";
import type { AuthPrincipal } from "../lib/authmod-core";

const actor: AuthPrincipal = { type: "interactive", id: "actor", displayName: "Admin", email: "admin@fikacatering.com", identityKind: "person" };
const setup = () => new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:mnk", label: "MNK", active: true }] });

test("staging launcher never falls back to localhost application URLs", () => {
  const priorMode = process.env.FIKA_RUNTIME_MODE;
  const priorCpuUrl = process.env.FIKA_APP_CPU_URL;
  process.env.FIKA_RUNTIME_MODE = "staging";
  delete process.env.FIKA_APP_CPU_URL;
  try { assert.equal(appHref("cpu-production"), undefined); }
  finally {
    if (priorMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = priorMode;
    if (priorCpuUrl === undefined) delete process.env.FIKA_APP_CPU_URL; else process.env.FIKA_APP_CPU_URL = priorCpuUrl;
  }
});

test("empty application registry bootstrap creates exactly the seven V1 apps and preserves governed changes", async () => {
  const repository = new MemoryAuthModRepository();
  const created = await ensureV1ApplicationRegistry(repository, actor);
  assert.equal(created.length, 7); assert.deepEqual((await repository.listApplications()).map(value => value.appId), V1_APPLICATIONS.map(value => value.appId));
  const governed = { ...(await repository.getApplication("logistics"))!, enabled: false, version: 9 }; await repository.saveApplication(governed);
  assert.equal((await ensureV1ApplicationRegistry(repository, actor)).length, 0); assert.equal((await repository.getApplication("logistics"))?.enabled, false); assert.equal((await repository.listApplications()).length, 7);
});

test("launcher shows only the currently effective assigned application", async () => {
  const repository = setup(); const identity = await createAuthIdentity(repository, { actor, displayName: "Person", email: "person@fikacatering.com", externalProvider: "firebase", externalUid: "person", provenance: "import" });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:mnk", actor, reason: "Assigned site." }); await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "cpu-production", actor, reason: "Assigned application." });
  const data = await buildLauncher(repository, { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind });
  assert.deepEqual(data.applications.map(value => value.appId), ["cpu-production"]); assert.equal(data.canAdministerAuthmod, false);
});

test("Full Access expands normal enabled applications without creating assignments or admin access", async () => {
  const repository = setup(); const identity = await createAuthIdentity(repository, { actor, displayName: "Full Person", email: "full@fikacatering.com", externalProvider: "firebase", externalUid: "full", provenance: "import" });
  const full = { ...identity, fullAccess: true, version: identity.version + 1 }; await repository.saveIdentity(full);
  const data = await buildLauncher(repository, { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind });
  assert.ok(data.applications.some(value => value.appId === "cpu-production")); assert.equal(data.canAdministerAuthmod, false); assert.equal((await repository.listAppAssignments(identity.id)).length, 0);
});

test("AUTHMOD administrator sees every registered application without per-app assignments", async () => {
  const repository = setup(); const identity = await createAuthIdentity(repository, { actor, displayName: "Administrator", email: "administrator@fikacatering.com", externalProvider: "firebase", externalUid: "administrator", provenance: "import" });
  await grantAuthmodAdmin(repository, { identityId: identity.id, actor, reason: "Launcher administrator access." });
  const data = await buildLauncher(repository, { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind });
  assert.deepEqual(data.applications.map(value => value.appId), V1_APPLICATIONS.map(value => value.appId)); assert.equal(data.canAdministerAuthmod, true);
});

test("restricted site account receives only its effective app and site access", async () => {
  const repository = setup(); const identity = await createAuthIdentity(repository, { actor, displayName: "Restricted", email: "restricted@fikacatering.com", externalProvider: "firebase", externalUid: "restricted", provenance: "import" });
  await assignSite(repository, { identityId: identity.id, oplocId: "oploc:mnk", actor, reason: "Restricted site assignment." }); await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "hospitality-booking", actor, reason: "Restricted application assignment." });
  const data = await buildLauncher(repository, { type: "interactive", id: identity.id, displayName: identity.displayName, email: identity.normalizedEmail, identityKind: identity.identityKind });
  assert.deepEqual(data.applications.map(value => value.appId), ["hospitality-booking"]);
});

test("operational and zero-access accounts remain truthful launcher states", async () => {
  const repository = setup(); const operational = await createAuthIdentity(repository, { actor, displayName: "CPU Production", email: "cpux@fikacatering.com", externalProvider: "firebase", externalUid: "cpu", identityKind: "operational", provenance: "import" });
  const empty = await createAuthIdentity(repository, { actor, displayName: "Empty", email: "empty@fikacatering.com", externalProvider: "firebase", externalUid: "empty", provenance: "import" });
  const operationalData = await buildLauncher(repository, { type: "interactive", id: operational.id, displayName: operational.displayName, email: operational.normalizedEmail, identityKind: operational.identityKind }); const emptyData = await buildLauncher(repository, { type: "interactive", id: empty.id, displayName: empty.displayName, email: empty.normalizedEmail, identityKind: empty.identityKind });
  assert.equal(operationalData.applications.length, 0); assert.equal(emptyData.applications.length, 0); assert.equal(operationalData.canAdministerAuthmod, false);
});
