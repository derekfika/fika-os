import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { executeCutover, readSnapshot } from "./execute";
import { createFirestoreStore } from "./firestore-store";
import { assertCanConnect, assertCanWrite, GuardError, type EnvironmentClass } from "./guards";
import { loadInputs, loadSnapshotDir } from "./inputs";
import { MemoryStore } from "./memory-store";
import { buildPlan } from "./plan";
import { PostCutoverChangesError, restoreCutover } from "./restore";
import { COLLECTIONS, MANIFEST_PATH, type CutoverStore } from "./store";
import { digest, sha256 } from "./digest";
import { verifyCutover } from "./verify";

const USAGE = `Dish Library V2 archive-and-cutover tool (issue #151). Read-only by default.

  npx tsx scripts/dish-library-v2/cutover.ts plan    (--snapshot-dir <dir> | --project <id> [--allow-production|--allow-staging]) --v2-records <file> --references <file>... [--out <file>]
  npx tsx scripts/dish-library-v2/cutover.ts execute --project <id> --v2-records <file> --references <file>... --execute --approval-hash <planHash> --approved-by <name> [--allow-production|--allow-staging]
  npx tsx scripts/dish-library-v2/cutover.ts rehearse --snapshot-dir <dir> --v2-records <file> --references <file>...   (in-memory plan -> execute -> verify -> restore drill; no network)
  npx tsx scripts/dish-library-v2/cutover.ts verify  --project <id> --cutover-id <id> --v2-records <file> --references <file>... [--expect-active 353]
  npx tsx scripts/dish-library-v2/cutover.ts restore --project <id> --archive-id <id> [--accept-post-cutover-changes] --execute --approval-hash <restoreHash> --approved-by <name>

Defaults: --survivors / --mappings point at apps/menu-planning/migrations/dish-library-v2/. Real Firestore also needs ${"FIKA_CUTOVER_ALLOW_REAL_FIRESTORE=1"}.
Emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 with --project demo-<name>.`;

type Args = { command?: string; flags: Map<string, string[]>; bools: Set<string> };
const BOOLEAN_FLAGS = new Set(["execute", "allow-production", "allow-staging", "summary", "help", "accept-post-cutover-changes"]);
export function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { bools.add(name); continue; }
    const value = rest[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    flags.set(name, [...(flags.get(name) || []), value]);
  }
  return { command, flags, bools };
}

export type CliIo = { out: (text: string) => void; err: (text: string) => void; env: NodeJS.ProcessEnv; cwd: string };
const defaults = (cwd: string) => ({ survivors: path.join(cwd, "migrations/dish-library-v2/v2-survivors-proposed.json"), mappings: path.join(cwd, "migrations/dish-library-v2/identity-mappings-proposed.json") });

function seededMemory(dir: string): MemoryStore {
  const store = new MemoryStore("memory-rehearsal");
  const snapshot = loadSnapshotDir(dir);
  for (const doc of snapshot.docs) store.seed(`${COLLECTIONS.catalogue}/${doc.id}`, doc.data);
  if (snapshot.manifest) store.seed(MANIFEST_PATH, snapshot.manifest);
  return store;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (!args.command || args.bools.has("help") || !["plan", "execute", "restore", "verify", "rehearse"].includes(args.command)) { io.out(USAGE); return args.command && !args.bools.has("help") ? 2 : 0; }
    const one = (name: string) => args.flags.get(name)?.[0];
    const project = one("project");
    const flags = { allowProduction: args.bools.has("allow-production"), allowStaging: args.bools.has("allow-staging") };
    const batchSize = one("batch-size") ? Number(one("batch-size")) : undefined;
    const attempt = one("attempt") ? Number(one("attempt")) : undefined;
    const memory = args.command === "rehearse";
    const loadAll = () => {
      const v2Records = one("v2-records");
      if (!v2Records) throw new Error("--v2-records <reviewed V2 export> is required.");
      const files = { ...defaults(io.cwd), allowlist: one("duplicate-allowlist") ?? path.join(io.cwd, "migrations/dish-library-v2/duplicate-name-allowlist.json"), ...(one("survivors") ? { survivors: one("survivors")! } : {}), ...(one("mappings") ? { mappings: one("mappings")! } : {}) };
      return loadInputs({ ...files, v2Records, references: args.flags.get("references") || [] });
    };

    // Store selection. Nothing is constructed before the guards approve it.
    let store: CutoverStore;
    if (args.command === "plan" && one("snapshot-dir") && !project) store = seededMemory(one("snapshot-dir")!);
    else if (memory) { if (!one("snapshot-dir")) throw new Error("rehearse needs --snapshot-dir."); store = seededMemory(one("snapshot-dir")!); }
    else { assertCanConnect(project, flags, io.env); store = createFirestoreStore(project!); }
    const environment: EnvironmentClass = memory || store.kind === "memory" ? "memory" : assertCanConnect(project, flags, io.env);
    const writeGuard = (computedHash: string) => assertCanWrite(project, { ...flags, memory: store.kind === "memory", execute: args.bools.has("execute"), approvalHash: one("approval-hash") ?? (environment === "emulator" || environment === "memory" ? computedHash : undefined), computedHash, approvedBy: one("approved-by") ?? (environment === "emulator" || environment === "memory" ? "local-rehearsal" : undefined) }, io.env);

    if (args.command === "rehearse") {
      const inputs = loadAll();
      const before = await readSnapshot(store);
      const planned = buildPlan(before, inputs, { batchSize, attempt });
      if (!planned.plan.executable) { io.out(JSON.stringify({ blocked: true, blockers: planned.plan.blockers }, null, 2)); return 3; }
      const executed = await executeCutover(store, inputs, { approvalHash: planned.plan.planHash, actor: "cutover-tool:rehearsal", approvedBy: "local-rehearsal", authorise: hash => assertCanWrite(undefined, { memory: true, execute: true, computedHash: hash }, {}), batchSize, attempt, log: message => io.err(message) });
      const verified = await verifyCutover(store, { cutoverId: executed.cutoverId, inputs, expectActive: planned.plan.target.active, sampleIds: args.flags.get("sample-id") });
      const restored = await restoreCutover(store, { archiveId: executed.cutoverId, actor: "cutover-tool:rehearsal", approvedBy: "local-rehearsal", authorise: hash => assertCanWrite(undefined, { memory: true, execute: true, computedHash: hash }, {}), batchSize });
      const after = await readSnapshot(store);
      const sameDocs = before.docs.length === after.docs.length && before.docs.every(item => digest(item.data) === digest(after.docs.find(candidate => candidate.id === item.id)?.data));
      const sameHash = before.manifest?.sourceHash === after.manifest?.sourceHash;
      io.out(JSON.stringify({ planHash: planned.plan.planHash, executed, verify: { ok: verified.ok, counts: verified.counts, failing: verified.checks.filter(check => !check.ok), references: verified.checks.find(check => check.name.startsWith("references resolve"))?.name, rollingNine: Object.fromEntries(inputs.nineRollingIds.map(id => [id, verified.resolverStates[id]])) }, restored, restoreReproducesV1: { documentsIdentical: sameDocs, sourceHashIdentical: sameHash } }, null, 2));
      return verified.ok && sameDocs && sameHash ? 0 : 4;
    }
    if (args.command === "plan") {
      const inputs = loadAll();
      const { plan } = buildPlan(await readSnapshot(store), inputs, { batchSize, attempt });
      if (one("out")) { mkdirSync(path.dirname(path.resolve(one("out")!)), { recursive: true }); const text = JSON.stringify(plan, null, 2) + "\n"; writeFileSync(one("out")!, text); writeFileSync(`${one("out")}.sha256`, `${sha256(text)}  ${path.basename(one("out")!)}\n`); }
      const { ops: _ops, archive, unresolvedArchived, ...summary } = plan;
      io.out(JSON.stringify(args.bools.has("summary") ? { ...summary, unresolvedArchived: unresolvedArchived.length, archive: { archiveId: archive.archiveId, docCount: archive.docCount, rootRawDigest: archive.rootRawDigest } } : plan, null, 2));
      return plan.executable ? 0 : 3;
    }
    if (args.command === "execute") {
      const inputs = loadAll();
      const local = environment === "emulator" || environment === "memory";
      const approvalHash = one("approval-hash") ?? (local ? buildPlan(await readSnapshot(store), inputs, { batchSize, attempt }).plan.planHash : undefined);
      if (!approvalHash) throw new GuardError(["--approval-hash is required"]);
      const result = await executeCutover(store, inputs, { approvalHash, actor: one("actor") ?? `cutover-tool:${one("approved-by") ?? "local"}`, approvedBy: one("approved-by") ?? "local-rehearsal", authorise: hash => writeGuard(hash), batchSize, attempt, log: message => io.err(message) });
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    if (args.command === "restore") {
      const archiveId = one("archive-id");
      if (!archiveId) throw new Error("--archive-id is required.");
      const result = await restoreCutover(store, { archiveId, actor: one("actor") ?? `cutover-tool:${one("approved-by") ?? "local"}`, approvedBy: one("approved-by") ?? "local-rehearsal", authorise: hash => writeGuard(hash), acceptPostCutoverChanges: args.bools.has("accept-post-cutover-changes"), batchSize, log: message => io.err(message) });
      io.out(JSON.stringify(result, null, 2));
      return 0;
    }
    const cutoverId = one("cutover-id");
    if (!cutoverId) throw new Error("--cutover-id is required.");
    const report = await verifyCutover(store, { cutoverId, inputs: loadAll(), expectActive: one("expect-active") ? Number(one("expect-active")) : undefined, sampleIds: args.flags.get("sample-id") });
    io.out(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 4;
  } catch (error) {
    if (error instanceof PostCutoverChangesError) { io.err(error.message); io.out(JSON.stringify(error.report, null, 2)); return 5; }
    if (error instanceof GuardError) { io.err(`${error.message}`); return 2; }
    io.err(`Error: ${(error as Error).message}`);
    return 1;
  }
}
