import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStagingMailRouting,
  decideOutboundRouting,
  OutboundGateError,
  tryDecideOutboundRouting,
  type OutboundGateInput,
} from "../src/outbound-environment";

const stagingIdentity = "fika-runtime@fika-os-dev.iam.gserviceaccount.com";
const productionIdentity = "fika-runtime@fika-os.iam.gserviceaccount.com";
const stagingConfig = {
  ownerInbox: "owner@example.test",
  driveRootFolderId: "rootFolderId0001",
  destinations: { quotes: "quotesFolder0001", menus: "menusFolder0001", allergenPdfs: "allergenFolder001" },
};
const staging = (over: Partial<OutboundGateInput> = {}): OutboundGateInput => ({
  mode: "staging",
  actualProjectId: "fika-os-dev",
  actualServiceIdentity: stagingIdentity,
  ...stagingConfig,
  ...over,
});
const production = (over: Partial<OutboundGateInput> = {}): OutboundGateInput => ({
  mode: "production",
  actualProjectId: "fika-os",
  actualServiceIdentity: productionIdentity,
  ...over,
});
const code = (input: OutboundGateInput) => {
  try {
    decideOutboundRouting(input);
  } catch (e) {
    assert.ok(e instanceof OutboundGateError);
    return e.code;
  }
  return "NO_ERROR";
};

test("production is an explicit passthrough that rewrites nothing", () => {
  assert.deepEqual(decideOutboundRouting(production()), { kind: "production", mail: "passthrough", drive: "passthrough" });
});

test("production rejects every staging override, including blank values", () => {
  for (const over of [
    { ownerInbox: "owner@example.test" },
    { ownerInbox: "" },
    { ownerInbox: "   " },
    { driveRootFolderId: "rootFolderId0001" },
    { driveRootFolderId: "" },
    { destinations: {} },
    { destinations: stagingConfig.destinations },
  ]) {
    assert.equal(code(production(over)), "OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING", JSON.stringify(over));
  }
});

test("staging happy path resolves the owner inbox and isolated Drive destinations", () => {
  assert.deepEqual(decideOutboundRouting(staging()), {
    kind: "staging",
    mailRecipient: "owner@example.test",
    drive: { root: "rootFolderId0001", quotes: "quotesFolder0001", menus: "menusFolder0001", allergenPdfs: "allergenFolder001" },
  });
});

test("unknown, missing or non-string modes fail closed", () => {
  for (const mode of ["", "prod", "Production", "development", undefined, null, 1 as unknown as string]) {
    assert.equal(code({ mode, actualProjectId: "fika-os" }), "OUTBOUND_UNKNOWN_MODE");
  }
});

test("mode/project mismatch fails closed in both directions", () => {
  assert.equal(code(staging({ actualProjectId: "fika-os" })), "OUTBOUND_PROJECT_MISMATCH");
  assert.equal(code(production({ actualProjectId: "fika-os-dev" })), "OUTBOUND_PROJECT_MISMATCH");
  assert.equal(code(staging({ actualProjectId: "" })), "OUTBOUND_PROJECT_MISMATCH");
  assert.equal(code(production({ actualProjectId: undefined })), "OUTBOUND_PROJECT_MISMATCH");
});

test("service identity must belong to the deployed project", () => {
  for (const identity of [
    undefined,
    null,
    "",
    "   ",
    productionIdentity, // production identity in staging
    "fika-runtime@fika-os-dev.iam.gserviceaccount.com.evil.test",
    "fika-runtime@evil.iam.gserviceaccount.com",
    "fika-runtime@fika-os-dev.iam.gserviceaccount.com ",
    "123456-compute@developer.gserviceaccount.com",
    "@fika-os-dev.iam.gserviceaccount.com",
  ]) {
    assert.equal(code(staging({ actualServiceIdentity: identity })), "OUTBOUND_IDENTITY_MISMATCH", String(identity));
  }
  assert.equal(code(production({ actualServiceIdentity: stagingIdentity })), "OUTBOUND_IDENTITY_MISMATCH");
  assert.equal(code(production({ actualServiceIdentity: undefined })), "OUTBOUND_IDENTITY_MISMATCH");
});

test("staging owner inbox must be one syntactically valid address", () => {
  for (const inbox of [
    undefined,
    null,
    "",
    "   ",
    "owner@example.test, other@example.test",
    "owner@example.test;other@example.test",
    "owner@example.test other@example.test",
    "Owner <owner@example.test>",
    "<owner@example.test>",
    "owner@example.test\r\nBcc: x@example.test",
    "owner@example.test\n",
    " owner@example.test",
    "owner@example.test ",
    "owner@@example.test",
    "owner@localhost",
    "owner",
    "own..er@example.test",
  ]) {
    assert.equal(code(staging({ ownerInbox: inbox })), "OUTBOUND_OWNER_INBOX_INVALID", JSON.stringify(inbox));
  }
});

test("staging requires a valid Drive root and every type destination", () => {
  const d = stagingConfig.destinations;
  for (const over of [
    { driveRootFolderId: undefined },
    { driveRootFolderId: "" },
    { driveRootFolderId: "   " },
    { driveRootFolderId: "short" },
    { driveRootFolderId: "root folder id 01" },
    { driveRootFolderId: "../../rootFolder01" },
    { destinations: undefined },
    { destinations: {} },
    { destinations: { ...d, quotes: undefined } },
    { destinations: { ...d, menus: "" } },
    { destinations: { ...d, allergenPdfs: "  " } },
    { destinations: { ...d, quotes: "bad/id/value01" } },
    { destinations: { ...d, quotes: d.menus } }, // duplicated destination
    { destinations: { ...d, menus: stagingConfig.driveRootFolderId } },
  ]) {
    assert.equal(code(staging(over)), "OUTBOUND_DRIVE_CONFIG_INVALID", JSON.stringify(over));
  }
});

test("no cross-environment overrides: production Drive IDs are rejected in staging", () => {
  const prodIds = ["prodRootFolder001"];
  assert.equal(code(staging({ driveRootFolderId: "prodRootFolder001", knownProductionDriveIds: prodIds })), "OUTBOUND_CROSS_ENVIRONMENT_REFERENCE");
  assert.equal(
    code(staging({ destinations: { ...stagingConfig.destinations, menus: "prodRootFolder001" }, knownProductionDriveIds: prodIds })),
    "OUTBOUND_CROSS_ENVIRONMENT_REFERENCE",
  );
  assert.equal(code(staging({ knownProductionDriveIds: prodIds })), "NO_ERROR");
  // And staging values cannot be smuggled into production.
  assert.equal(code(production({ ...stagingConfig })), "OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING");
});

test("local mode is blocked, refuses real projects and staging overrides", () => {
  assert.deepEqual(decideOutboundRouting({ mode: "local", actualProjectId: "fika-os-local" }), { kind: "local", mail: "blocked", drive: "blocked" });
  assert.equal(code({ mode: "local", actualProjectId: "fika-os" }), "OUTBOUND_PROJECT_MISMATCH");
  assert.equal(code({ mode: "local", actualProjectId: "fika-os-dev" }), "OUTBOUND_PROJECT_MISMATCH");
  assert.equal(code({ mode: "local", actualProjectId: "fika-os-local", ownerInbox: "owner@example.test" }), "OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING");
  assert.throws(() => applyStagingMailRouting(decideOutboundRouting({ mode: "local", actualProjectId: "fika-os-local" }), { to: "a@example.test" }), /blocked in local/);
});

test("errors are retryable, machine-readable and never echo configuration", () => {
  const secretInbox = "secret.person@private-domain.test\r\nBcc: leak@example.test";
  const secretRoot = "SECRETROOTFOLDER_ID!";
  const secretIdentity = "leaky@other-project.iam.gserviceaccount.com";
  for (const input of [
    staging({ ownerInbox: secretInbox }),
    staging({ driveRootFolderId: secretRoot }),
    staging({ actualServiceIdentity: secretIdentity }),
    production({ ownerInbox: secretInbox }),
  ]) {
    const result = tryDecideOutboundRouting(input);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.ok(result.error instanceof OutboundGateError);
    assert.equal(result.error.retryable, true);
    assert.match(result.error.code, /^OUTBOUND_[A-Z_]+$/);
    assert.ok(result.error.message.length > 0);
    const text = `${result.error.message} ${result.error.code} ${JSON.stringify(result.error)}`;
    for (const secret of ["secret.person", "private-domain", "SECRETROOT", "other-project", "leak@"]) assert.ok(!text.includes(secret), secret);
  }
  assert.deepEqual(tryDecideOutboundRouting(production()), { ok: true, decision: { kind: "production", mail: "passthrough", drive: "passthrough" } });
});

test("the decision function does not mutate its input", () => {
  const input = staging();
  const snapshot = JSON.stringify(input);
  decideOutboundRouting(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("staging rewrite replaces To/CC/BCC with the single inbox and keeps only a count", () => {
  const decision = decideOutboundRouting(staging());
  const original = { to: ["customer@client.test", "second@client.test"], cc: "boss@client.test", bcc: ["hidden@client.test"], subject: "Quote", html: "<p>x</p>" };
  const routed = applyStagingMailRouting(decision, original);
  assert.notEqual(routed, original);
  assert.deepEqual(routed.to, ["owner@example.test"]);
  assert.deepEqual((routed as { cc: string[] }).cc, []);
  assert.deepEqual((routed as { bcc: string[] }).bcc, []);
  assert.equal((routed as { subject: string }).subject, "Quote");
  assert.deepEqual((routed as { outboundRouting: unknown }).outboundRouting, { redirected: true, originalRecipientCount: 4 });
  assert.ok(!JSON.stringify(routed).includes("client.test"));
  assert.deepEqual(original.to, ["customer@client.test", "second@client.test"]); // input untouched
});

test("staging rewrite handles messages with no recipients and still targets the inbox", () => {
  const routed = applyStagingMailRouting(decideOutboundRouting(staging()), { subject: "S" });
  assert.deepEqual((routed as { to: string[] }).to, ["owner@example.test"]);
  assert.equal((routed as { outboundRouting: { originalRecipientCount: number } }).outboundRouting.originalRecipientCount, 0);
});

test("production rewrite returns the same message reference unchanged", () => {
  const message = { to: ["customer@client.test"], cc: ["c@client.test"], subject: "Quote" };
  assert.equal(applyStagingMailRouting(decideOutboundRouting(production()), message), message);
  assert.deepEqual(message.to, ["customer@client.test"]);
});

test("rewrite rejects missing or malformed decisions", () => {
  for (const decision of [undefined, null, {} as never, { kind: "staging", mailRecipient: "a@b.test, c@d.test", drive: {} } as never]) {
    assert.throws(() => applyStagingMailRouting(decision, { to: "x@y.test" }), (e: unknown) => e instanceof OutboundGateError && e.code === "OUTBOUND_INVALID_DECISION");
  }
});
