import assert from "node:assert/strict";
import test from "node:test";
import { publishAfterCommit, runCommittedCommand } from "../lib/authmod-core/commit-publication";
import { readAccountActionResponse } from "../app/authmod/accounts/[id]/action-response";

test("committed publication failure returns a saved warning, not a failed command", async () => {
  const result = await runCommittedCommand(() => publishAfterCommit("identity:test", async () => { throw Error("storage unavailable"); }));
  assert.match(result.warning!, /saved.*Do not repeat/);
  const account = { apps: [{ id: "example-app" }] };
  const response = await readAccountActionResponse<typeof account>(Response.json({ account, committed: true, warning: result.warning }));
  assert.deepEqual(response.account, account);
  assert.equal(response.committed, true);
  assert.equal(response.warning, result.warning);
});

test("pre-commit failures retain their failure semantics", async () => {
  const rejection = Object.assign(Error("version conflict"), { status: 409 });
  await assert.rejects(runCommittedCommand(async () => { throw rejection; }), error => error === rejection);
  await assert.rejects(readAccountActionResponse(Response.json({ error: { message: "version conflict" } }, { status: 409 })), /version conflict/);
});

test("inactive identities intentionally do not publish an access package", async () => {
  const result = await runCommittedCommand(() => publishAfterCommit("identity:inactive", async () => { throw Object.assign(Error("inactive"), { code: "AUTHMOD_IDENTITY_INACTIVE" }); }));
  assert.deepEqual(result, {});
});

test("successful commands remain warning-free", async () => {
  assert.deepEqual(await runCommittedCommand(() => publishAfterCommit("identity:active", async () => undefined)), {});
});
