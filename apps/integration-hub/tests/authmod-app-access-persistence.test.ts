import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthmodAccount } from "../lib/authmod-admin-read-model";
import { MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantStandardApplicationAccess, publishAfterCommit, runCommittedCommand, isCommittedPublicationError } from "../lib/authmod-core";
import type { AuthPrincipal } from "../lib/authmod-core";
import { errorSectionFor, readActionResponse } from "../app/authmod/accounts/[id]/action-response";

const admin: AuthPrincipal = { type: "interactive", id: "actor:admin", displayName: "Admin", identityKind: "person" };
async function setup() {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS], oplocs: [{ id: "oploc:example", label: "Example", active: true }] });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "FIKA @ Example", email: "ops@example.test", externalProvider: "workspace", externalUid: "workspace:ops", identityKind: "operational", representedOplocId: "oploc:example", provenance: "import" });
  return { repository, identity };
}
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("successful save returns the newly enabled application on an operational account", async () => {
  const { repository, identity } = await setup();
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "logistics", actor: admin });
  const account = await buildAuthmodAccount(repository, identity.id);
  assert.deepEqual(account.apps.map(value => value.id), ["logistics"]);
  const parsed = await readActionResponse<typeof account>(response(200, { account }));
  assert.deepEqual(parsed.account.apps.map(value => value.id), ["logistics"]); assert.equal(parsed.warning, undefined);
});

test("repeating a committed grant is idempotent: no duplicate assignment or grants", async () => {
  const { repository, identity } = await setup();
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "logistics", actor: admin });
  const grantsBefore = (await repository.listAuthorityGrants(identity.id, "interactive")).length;
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "logistics", actor: admin });
  assert.equal((await repository.listAppAssignments(identity.id)).length, 1);
  assert.equal((await repository.listAuthorityGrants(identity.id, "interactive")).length, grantsBefore);
});

test("rejected save surfaces the server message and routes app errors beside Application Access", async () => {
  await assert.rejects(readActionResponse(response(409, { error: { message: "This account changed since it was opened." } })), /changed since it was opened/);
  await assert.rejects(readActionResponse(response(500, "not json")), /could not complete/);
  assert.equal(errorSectionFor({ action: "app" }), "apps"); assert.equal(errorSectionFor({ action: "site" }), "page");
});

test("committed write followed by package-publication failure is a warning, not a failed save", async () => {
  const { repository, identity } = await setup();
  const result = await runCommittedCommand(async () => {
    await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: "logistics", actor: admin });
    await publishAfterCommit(identity.id, async () => { throw new Error("storage unavailable"); });
  });
  assert.match(result.warning || "", /saved/);
  const account = await buildAuthmodAccount(repository, identity.id);
  assert.deepEqual(account.apps.map(value => value.id), ["logistics"]);
  const parsed = await readActionResponse(response(200, { account, warning: result.warning }));
  assert.equal(parsed.warning, result.warning);
});

test("publication helper: inactive identities are skipped, other failures are marked committed, non-committed errors propagate", async () => {
  await publishAfterCommit("x", async () => { throw Object.assign(new Error("inactive"), { code: "AUTHMOD_IDENTITY_INACTIVE" }); });
  await assert.rejects(publishAfterCommit("x", async () => { throw new Error("boom"); }), error => isCommittedPublicationError(error));
  await assert.rejects(runCommittedCommand(async () => { throw Object.assign(new Error("conflict"), { status: 409 }); }), /conflict/);
});
