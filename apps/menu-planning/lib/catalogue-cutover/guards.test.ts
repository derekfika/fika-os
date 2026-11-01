import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digest as resolverDigest } from "./digest";
import { AlreadyExistsError } from "./store";
import { MemoryStore } from "./memory-store";
import { assertCanConnect, assertCanWrite, classifyProject, GuardError } from "./guards";
import { main, parseArgs } from "./cli";

const hash = "a".repeat(64);
const refusal = (fn: () => unknown) => { try { fn(); } catch (error) { assert.ok(error instanceof GuardError); return (error as GuardError).violations.join(" | "); } assert.fail("expected a refusal"); };

describe("guards", () => {
  it("classifies projects and refuses everything off the allowlist", () => {
    assert.equal(classifyProject("demo-x", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }), "emulator");
    assert.equal(classifyProject("fika-os-dev", {}), "staging");
    assert.equal(classifyProject("fika-os", {}), "production");
    assert.match(refusal(() => classifyProject("demo-x", {})), /needs FIRESTORE_EMULATOR_HOST/);
    assert.match(refusal(() => classifyProject("fika-os", { FIRESTORE_EMULATOR_HOST: "h" })), /not a demo-/);
    assert.match(refusal(() => classifyProject("some-other-project", {})), /not on the allowlist/);
    assert.match(refusal(() => classifyProject(undefined, {})), /--project is required/);
  });

  it("real Firestore needs the environment opt-in and the matching allow flag, even to read", () => {
    assert.match(refusal(() => assertCanConnect("fika-os", { allowProduction: true }, {})), /FIKA_CUTOVER_ALLOW_REAL_FIRESTORE/);
    assert.match(refusal(() => assertCanConnect("fika-os", {}, { FIKA_CUTOVER_ALLOW_REAL_FIRESTORE: "1" })), /--allow-production/);
    assert.match(refusal(() => assertCanConnect("fika-os-dev", {}, { FIKA_CUTOVER_ALLOW_REAL_FIRESTORE: "1" })), /--allow-staging/);
    assert.equal(assertCanConnect("fika-os", { allowProduction: true }, { FIKA_CUTOVER_ALLOW_REAL_FIRESTORE: "1" }), "production");
  });

  it("production write requires execute, allow-production, approver, and an approval hash equal to the computed plan hash", () => {
    const env = { FIKA_CUTOVER_ALLOW_REAL_FIRESTORE: "1" };
    const ok = { execute: true, allowProduction: true, approvalHash: hash, approvedBy: "Derek", computedHash: hash };
    assert.equal(assertCanWrite("fika-os", ok, env), "production");
    for (const [label, change, pattern] of [
      ["execute", { execute: false }, /--execute is required/],
      ["allow", { allowProduction: false }, /--allow-production/],
      ["approver", { approvedBy: " " }, /--approved-by/],
      ["hash missing", { approvalHash: undefined }, /--approval-hash is required/],
      ["hash mismatch", { approvalHash: "b".repeat(64) }, /does not equal the computed hash/],
    ] as const) assert.match(refusal(() => assertCanWrite("fika-os", { ...ok, ...change }, env)), pattern, label);
    assert.match(refusal(() => assertCanWrite("fika-os", ok, {})), /FIKA_CUTOVER_ALLOW_REAL_FIRESTORE/);
  });

  it("emulator and memory rehearsals still need --execute", () => {
    assert.equal(assertCanWrite("demo-x", { execute: true, computedHash: hash }, { FIRESTORE_EMULATOR_HOST: "h" }), "emulator");
    assert.equal(assertCanWrite(undefined, { memory: true, execute: true, computedHash: hash }, {}), "memory");
    assert.match(refusal(() => assertCanWrite("demo-x", { computedHash: hash }, { FIRESTORE_EMULATOR_HOST: "h" })), /--execute/);
  });
});

describe("cli", () => {
  it("refuses production without ever building a Firestore client", async () => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (text: string) => out.push(text), err: (text: string) => err.push(text), env: {} as NodeJS.ProcessEnv, cwd: process.cwd() };
    for (const argv of [["plan", "--project", "fika-os", "--v2-records", "x"], ["execute", "--project", "fika-os", "--allow-production", "--execute", "--v2-records", "x"], ["restore", "--project", "fika-os", "--archive-id", "a", "--execute"], ["plan", "--project", "other", "--v2-records", "x"]]) {
      assert.equal(await main(argv, io), 2, argv.join(" "));
    }
    assert.ok(err.every(line => /Refused/.test(line)));
    assert.equal(await main([], io), 0);
    assert.equal(await main(["bogus"], io), 2);
    assert.throws(() => parseArgs(["plan", "--project"]), /needs a value/);
  });
});

describe("in-memory store fidelity", () => {
  it("create fails when the document exists, batches are atomic, and undefined is rejected like Firestore", async () => {
    const store = new MemoryStore();
    await store.writeBatch([{ op: "create", path: "c/a", data: { v: 1 } }]);
    await assert.rejects(store.writeBatch([{ op: "set", path: "c/b", data: { v: 2 } }, { op: "create", path: "c/a", data: { v: 3 } }]), AlreadyExistsError);
    assert.equal(await store.get("c/b"), undefined, "nothing from a failed batch is written");
    await assert.rejects(store.writeBatch([{ op: "set", path: "c/u", data: { v: undefined } }]), /undefined/);
    await assert.rejects(store.writeBatch([{ op: "set", path: "c/d", data: { v: new Date() } }]), /Non-plain/);
  });

  it("transactions retry when a document they read changes, and abort after repeated contention", async () => {
    const store = new MemoryStore();
    store.seed("c/a", { n: 1 });
    let attempts = 0;
    store.beforeCommit = attempt => { if (attempt === 1) store.seed("c/a", { n: 2 }); };
    const seen = await store.runTransaction(async tx => { attempts++; const current = await tx.get("c/a"); tx.set("c/a", { n: Number(current!.n) + 10 }); return current!.n; });
    assert.equal(attempts, 2);
    assert.equal(seen, 2);
    assert.deepEqual(await store.get("c/a"), { n: 12 });
    store.beforeCommit = () => store.seed("c/a", { n: Math.random() });
    await assert.rejects(store.runTransaction(async tx => { await tx.get("c/a"); tx.set("c/a", { n: 0 }); }), /ABORTED/);
    store.beforeCommit = undefined;
    await assert.rejects(store.runTransaction(async tx => { tx.set("c/a", { n: 0 }); await tx.get("c/a"); }), /reads before writes/);
  });

  it("collection listings are validated too (a new document invalidates the read)", async () => {
    const store = new MemoryStore();
    store.seed("c/a", { n: 1 });
    let attempts = 0;
    store.beforeCommit = attempt => { if (attempt === 1) store.seed("c/b", { n: 2 }); };
    const count = await store.runTransaction(async tx => { attempts++; return (await tx.list("c")).length; });
    assert.equal(attempts, 2);
    assert.equal(count, 2);
  });
});

describe("digest compatibility with the #256 resolver", () => {
  it("digest() equals dishReferenceDigest() for the same values", async () => {
    const { dishReferenceDigest } = await import("../dish-reference-resolver");
    for (const value of [{ b: 1, a: [{ z: null, y: "x" }] }, { id: "menu-item:local:x", data: { kind: "dish", record: { n: 1, tagIds: ["a"] } } }, ["a", 1, { k: false }]]) assert.equal(resolverDigest(value), dishReferenceDigest(value));
  });
});
