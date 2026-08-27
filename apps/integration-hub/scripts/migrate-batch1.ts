import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { getApps, initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

export const SOURCE_EXPORT = "C:\\FIKA\\local-data\\integration-hub\\recovery\\oploc-published-2026-08-27";
export const EXPECTED_SOURCE_FINGERPRINT = "ef2ae950505e9d72df2954438e577f4cb021047c9c6f65c8334eae13631fcf21";
export const DESTINATION_PROJECT = "fika-os-dev";
export const DESTINATION_DATABASE = "(default)";
export const CORE_ENTITY_TYPES = ["OPLOC", "Address", "Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price"] as const;
export const EXPECTED_CORE_COUNTS: Record<CoreEntityType, number> = { OPLOC: 23, Address: 7, "Hospitality Menu Item": 43, "Hospitality Menu Offering": 43, "Hospitality Menu Price": 42 };
export const PROVENANCE_COLLECTIONS = ["integrationHubCanonicalRevisions", "integrationHubSourceMappings", "integrationHubGovernanceAudit"] as const;
export const PROTECTED_COLLECTION_PREFIXES = ["authmod"] as const;
export const PROTECTED_COLLECTIONS = [
  "authmodIdentities", "authmodCustodianAssignments", "authmodApplications", "authmodSiteAssignments",
  "authmodAppAssignments", "authmodAuthorityGrants", "authmodDelegations", "authmodServicePrincipals",
  "authmodImports", "authmodImportResolutions", "authmodAccessAudit",
] as const;

type CoreEntityType = typeof CORE_ENTITY_TYPES[number];
type ProvenanceCollection = typeof PROVENANCE_COLLECTIONS[number];
type BatchCollection = "integrationHubCanonical" | ProvenanceCollection;
type Outcome = "CREATE" | "IDENTICAL_SKIP" | "CONFLICT" | "PROTECTED_SKIP";

export type SelectedRecord = {
  collection: BatchCollection;
  id: string;
  canonicalId?: string;
  entityType?: string;
  data: DocumentData;
  hash: string;
};

export type EnvironmentWarning = { collection: string; documentId: string; field: string; kind: string };
export type ReferenceIssue = { collection: string; documentId: string; field: string; value?: string; kind: "MISSING" | "EXCLUDED" | "INVALID" };

export function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify({ __bytes: value.toString("base64") });
  if (typeof (value as { toDate?: unknown }).toDate === "function") return JSON.stringify((value as { toDate: () => Date }).toDate().toISOString());
  if (typeof (value as { path?: unknown }).path === "string") return JSON.stringify({ __reference: (value as { path: string }).path });
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

export function documentHash(data: DocumentData): string {
  return crypto.createHash("sha256").update(stableSerialize(data)).digest("hex");
}

export function flattenStrings(value: unknown, prefix = "", output: Array<{ field: string; value: string }> = []) {
  if (typeof value === "string") { output.push({ field: prefix || "$", value }); return output; }
  if (Array.isArray(value)) { value.forEach((item, index) => flattenStrings(item, `${prefix}[${index}]`, output)); return output; }
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate !== "function") {
    for (const [key, item] of Object.entries(value)) flattenStrings(item, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

export function assertDestinationSafety(env: Record<string, string | undefined> = process.env) {
  const mode = env.FIKA_RUNTIME_MODE?.trim();
  const project = env.FIREBASE_PROJECT_ID?.trim();
  const candidates = [env.FIREBASE_PROJECT_ID, env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].filter(Boolean).map(value => value!.trim());
  if (mode !== "staging") throw new Error("Batch 1 requires FIKA_RUNTIME_MODE=staging.");
  if (candidates.some(value => value !== DESTINATION_PROJECT) || project !== DESTINATION_PROJECT) throw new Error(`Destination project must be exactly ${DESTINATION_PROJECT}.`);
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Destination emulator configuration is forbidden.");
  if (env.FIREBASE_CONFIG) {
    try {
      const config = JSON.parse(env.FIREBASE_CONFIG) as { projectId?: string; project_id?: string };
      const configured = config.projectId || config.project_id;
      if (configured && configured !== DESTINATION_PROJECT) throw new Error("FIREBASE_CONFIG targets a different project.");
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("FIREBASE_CONFIG is ambiguous or invalid.");
      throw error;
    }
  }
  return { projectId: DESTINATION_PROJECT, database: DESTINATION_DATABASE } as const;
}

export function assertSourceExport(exportPath: string): string {
  const resolved = path.resolve(exportPath);
  if (resolved !== path.resolve(SOURCE_EXPORT)) throw new Error(`Source export must be exactly ${SOURCE_EXPORT}.`);
  const metadata = path.join(resolved, "firestore_export", "firestore_export.overall_export_metadata");
  const wrapper = path.join(resolved, "firebase-export-metadata.json");
  if (!fs.existsSync(resolved) || !fs.existsSync(metadata) || !fs.existsSync(wrapper)) throw new Error("Source export is missing required Firestore/export metadata.");
  return resolved;
}

export function fingerprintDirectory(root: string): string {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target); else files.push(target);
    }
  };
  walk(root);
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const bytes = fs.readFileSync(file);
    hash.update(relative).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export function isProtectedCollection(collection: string): boolean {
  return PROTECTED_COLLECTIONS.includes(collection as typeof PROTECTED_COLLECTIONS[number]) || PROTECTED_COLLECTION_PREFIXES.some(prefix => collection.startsWith(prefix));
}

export function selectBatch1(canonicalDocs: QueryDocumentSnapshot[], provenanceDocs: Record<ProvenanceCollection, QueryDocumentSnapshot[]>) {
  const core: SelectedRecord[] = canonicalDocs.flatMap(document => {
    const data = document.data();
    const entityType = String(data.entityType || "");
    // OPLOC publication is governed by lifecycleStatus in the current canonical contract;
    // older OPLOC records may not carry the newer publicationStatus field.
    const published = data.lifecycleStatus === "published" && (entityType === "OPLOC" || data.publicationStatus === "published");
    const addressApproved = entityType !== "Address" || data.record?.approvalState === "approved" || data.record?.approvalState === undefined;
    if (!CORE_ENTITY_TYPES.includes(entityType as CoreEntityType) || !published || !addressApproved) return [];
    return [{ collection: "integrationHubCanonical" as const, id: document.id, canonicalId: String(data.canonicalId || ""), entityType, data, hash: documentHash(data) }];
  });
  const selectedIds = new Set(core.map(record => record.canonicalId).filter(Boolean));
  const provenance = (Object.entries(provenanceDocs) as Array<[ProvenanceCollection, QueryDocumentSnapshot[]]>).flatMap(([collection, docs]) => docs.flatMap(document => {
    const data = document.data();
    const values = flattenStrings(data).map(item => item.value);
    if (!values.some(value => selectedIds.has(value))) return [];
    return [{ collection, id: document.id, canonicalId: typeof data.canonicalId === "string" ? data.canonicalId : undefined, entityType: typeof data.entityType === "string" ? data.entityType : undefined, data, hash: documentHash(data) }];
  }));
  return { core, provenance, selectedIds };
}

export function findEnvironmentWarnings(records: SelectedRecord[]): EnvironmentWarning[] {
  const warnings: EnvironmentWarning[] = [];
  for (const record of records) {
    for (const { field, value } of flattenStrings(record.data)) {
      const lowerField = field.toLowerCase();
      const lowerValue = value.toLowerCase();
      let kind = "";
      if (lowerValue.includes("localhost") || lowerValue.includes("127.0.0.1") || lowerValue.includes("fika-os-local")) kind = "local/emulator value";
      else if (/^[a-z]:\\|^\\\\|^\/users\/|^\/home\//i.test(value) || ["localurl", "pdfpath", "filesystempath"].some(token => lowerField.includes(token))) kind = "local filesystem/path value";
      else if (lowerField.includes("secret") || lowerField.includes("token") || lowerField.includes("password") || lowerField.includes("credential")) kind = "credential-like field";
      else if (lowerField.endsWith("actorid") && (lowerValue.includes("local") || lowerValue.startsWith("bmu1"))) kind = "local actor identifier";
      if (kind) warnings.push({ collection: record.collection, documentId: record.id, field, kind });
    }
  }
  return warnings;
}

export function validateReferences(records: SelectedRecord[], allCanonical: QueryDocumentSnapshot[]): ReferenceIssue[] {
  const selected = new Set(records.filter(record => record.collection === "integrationHubCanonical").map(record => record.canonicalId).filter(Boolean));
  const all = new Set(allCanonical.map(document => String(document.data().canonicalId || "")).filter(Boolean));
  const issues: ReferenceIssue[] = [];
  for (const record of records.filter(item => item.collection === "integrationHubCanonical")) {
    for (const { field, value } of flattenStrings(record.data)) {
      if (!/reference|oploc|menuitem|offering|price|canonicalid|target/i.test(field)) continue;
      if (!/^(oploc:|address:|hospitality-menu-item:|hospitality-menu-offering:|hospitality-menu-price:)/i.test(value)) continue;
      if (!all.has(value)) issues.push({ collection: record.collection, documentId: record.id, field, value, kind: "MISSING" });
      else if (!selected.has(value)) issues.push({ collection: record.collection, documentId: record.id, field, value, kind: "EXCLUDED" });
    }
  }
  return issues;
}

function conciseDiff(source: DocumentData, destination: DocumentData): string[] {
  const sourceFlat = new Map(flattenStrings(source).map(item => [item.field, item.value]));
  const destinationFlat = new Map(flattenStrings(destination).map(item => [item.field, item.value]));
  const fields = new Set([...sourceFlat.keys(), ...destinationFlat.keys()]);
  return [...fields].filter(field => sourceFlat.get(field) !== destinationFlat.get(field)).slice(0, 12);
}

export function isAcceptedEnvironmentWarning(warning: EnvironmentWarning): boolean {
  return warning.kind === "local actor identifier";
}

export async function writeSelectedRecords(destination: Firestore, records: SelectedRecord[]) {
  const results: Array<{ outcome: "CREATE" | "CONFLICT" | "FAILURE"; record: SelectedRecord; error?: string; destinationHash?: string }> = [];
  for (const record of records) {
    try {
      await destination.collection(record.collection).doc(record.id).create(record.data);
      results.push({ outcome: "CREATE", record });
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (code === 6 || code === "already-exists") {
        const existing = await destination.collection(record.collection).doc(record.id).get();
        const destinationHash = existing.exists ? documentHash(existing.data() || {}) : undefined;
        results.push({ outcome: "CONFLICT", record, destinationHash, error: "Document appeared after preflight and was not overwritten." });
      } else results.push({ outcome: "FAILURE", record, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export async function countCollection(db: Firestore, collection: string): Promise<number> {
  const aggregate = await db.collection(collection).count().get();
  return aggregate.data().count;
}

export async function readCollection(db: Firestore, collection: string): Promise<QueryDocumentSnapshot[]> {
  return (await db.collection(collection).get()).docs;
}

async function waitForPort(host: string, port: number, child: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Source emulator exited before becoming ready (code ${child.exitCode}).`);
    try {
      await new Promise<void>((resolve, reject) => { const socket = net.createConnection({ host, port }); socket.once("connect", () => { socket.destroy(); resolve(); }); socket.once("error", reject); socket.setTimeout(250, () => { socket.destroy(); reject(new Error("timeout")); }); });
      return;
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error("Timed out starting isolated source emulator.");
}

export async function startSource(exportPath: string): Promise<{ child: ChildProcess; app: App; db: Firestore }> {
  const port = 18000 + Math.floor(Math.random() * 500);
  const configPath = path.join(os.tmpdir(), `fika-batch1-${process.pid}-${Date.now()}.json`);
  const config = { emulators: { firestore: { port }, ui: { enabled: false }, singleProjectMode: false } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const cli = process.env.FIREBASE_CLI_PATH || path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "firebase.cmd" : "firebase");
  const child = spawn(cli, ["emulators:start", "--only", "firestore", "--config", configPath, "--project", "fika-os-local", "--import", exportPath], { cwd: process.cwd(), stdio: "ignore", windowsHide: true, shell: process.platform === "win32" });
  await waitForPort("127.0.0.1", port, child);
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${port}`;
  const app = initializeApp({ projectId: "fika-os-local" }, `fika-batch1-source-${process.pid}`);
  const db = getFirestore(app);
  delete process.env.FIRESTORE_EMULATOR_HOST;
  return { child, app, db };
}

export async function stopSource(child: ChildProcess, app: App) {
  try { await deleteApp(app); } catch { /* already stopped */ }
  if (child.exitCode === null) {
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>(resolve => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      });
    } else child.kill("SIGINT");
  }
}

export async function runDryRun(options: { sourceExport?: string; execute?: boolean; expectedFingerprint?: string } = {}) {
  const sourcePath = assertSourceExport(options.sourceExport || SOURCE_EXPORT);
  assertDestinationSafety();
  const runId = crypto.randomUUID();
  const sourceFingerprint = fingerprintDirectory(sourcePath);
  const expectedFingerprint = options.expectedFingerprint || EXPECTED_SOURCE_FINGERPRINT;
  if (sourceFingerprint !== expectedFingerprint) throw new Error(`Source fingerprint mismatch before execution. Expected ${expectedFingerprint}, got ${sourceFingerprint}.`);
  const sourceMetadata = JSON.parse(fs.readFileSync(path.join(sourcePath, "firebase-export-metadata.json"), "utf8")) as Record<string, unknown>;
  let source: { child: ChildProcess; app: App; db: Firestore } | undefined;
  try {
    source = await startSource(sourcePath);
    const destinationApp = initializeApp({ projectId: DESTINATION_PROJECT }, `fika-batch1-destination-${process.pid}`);
    const destination = getFirestore(destinationApp);
    const canonical = await readCollection(source.db, "integrationHubCanonical");
    const provenanceDocs = {
      integrationHubCanonicalRevisions: await readCollection(source.db, "integrationHubCanonicalRevisions"),
      integrationHubSourceMappings: await readCollection(source.db, "integrationHubSourceMappings"),
      integrationHubGovernanceAudit: await readCollection(source.db, "integrationHubGovernanceAudit"),
    };
    const selected = selectBatch1(canonical, provenanceDocs);
    const selectedRecords = [...selected.core, ...selected.provenance];
    const sourceCoreDiagnostics = canonical
      .filter(document => CORE_ENTITY_TYPES.includes(String(document.data().entityType) as CoreEntityType))
      .reduce<Record<string, number>>((counts, document) => {
        const data = document.data();
        const key = [data.entityType, data.publicationStatus || "<missing-publication>", data.lifecycleStatus || "<missing-lifecycle>"].join(" | ");
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {});
    const sourceOplocRecords = canonical
      .filter(document => document.data().entityType === "OPLOC")
      .map(document => {
        const data = document.data();
        const record = data.record && typeof data.record === "object" ? data.record as Record<string, unknown> : {};
        return {
          id: document.id,
          canonicalId: data.canonicalId,
          publicationStatus: data.publicationStatus,
          lifecycleStatus: data.lifecycleStatus,
          name: record.name || record.siteName || record.displayName || data.name || data.displayName,
          addressId: record.addressId || record.addressReference,
        };
      });
    const referenceIssues = validateReferences(selectedRecords, canonical);
    const environmentWarnings = findEnvironmentWarnings(selectedRecords);
    const destinationBeforeCounts: Record<string, number> = {};
    for (const collection of ["integrationHubCanonical", ...PROVENANCE_COLLECTIONS]) destinationBeforeCounts[collection] = await countCollection(destination, collection);
    const protectedBeforeCounts: Record<string, number> = {};
    for (const collection of PROTECTED_COLLECTIONS) protectedBeforeCounts[collection] = await countCollection(destination, collection);
    const outcomes: Array<{ outcome: Outcome; record: SelectedRecord; destinationHash?: string; differences?: string[] }> = [];
    for (const record of selectedRecords) {
      if (isProtectedCollection(record.collection)) { outcomes.push({ outcome: "PROTECTED_SKIP", record }); continue; }
      const existing = await destination.collection(record.collection).doc(record.id).get();
      if (!existing.exists) outcomes.push({ outcome: "CREATE", record });
      else {
        const destinationHash = documentHash(existing.data() || {});
        outcomes.push(destinationHash === record.hash ? { outcome: "IDENTICAL_SKIP", record, destinationHash } : { outcome: "CONFLICT", record, destinationHash, differences: conciseDiff(record.data, existing.data() || {}) });
      }
    }
    const conflicts = outcomes.filter(item => item.outcome === "CONFLICT");
    const validationFailures = referenceIssues.length;
    const warningCounts = Object.fromEntries(Object.entries(environmentWarnings.reduce<Record<string, number>>((counts, warning) => {
      counts[warning.kind] = (counts[warning.kind] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)));
    const acceptedWarningFailures = environmentWarnings.filter(warning => !isAcceptedEnvironmentWarning(warning));
    const countMismatch = CORE_ENTITY_TYPES.some(type => selected.core.filter(record => record.entityType === type).length !== EXPECTED_CORE_COUNTS[type]);
    const preflightSafe = conflicts.length === 0 && validationFailures === 0 && acceptedWarningFailures.length === 0 && !countMismatch && selected.core.length === Object.values(EXPECTED_CORE_COUNTS).reduce((total, count) => total + count, 0);
    const fingerprintBeforeExecution = options.execute ? fingerprintDirectory(sourcePath) : undefined;
    if (options.execute && fingerprintBeforeExecution !== expectedFingerprint) throw new Error(`Source fingerprint changed before execution. Expected ${expectedFingerprint}, got ${fingerprintBeforeExecution}.`);
    const writeResults = options.execute && preflightSafe ? await writeSelectedRecords(destination, selectedRecords) : [];
    const failures = writeResults.filter(result => result.outcome === "FAILURE");
    const writeConflicts = writeResults.filter(result => result.outcome === "CONFLICT");
    const verificationFailures: Array<{ collection: string; documentId: string; reason: string }> = [];
    if (options.execute && preflightSafe) {
      for (const record of selectedRecords) {
        const document = await destination.collection(record.collection).doc(record.id).get();
        if (!document.exists) verificationFailures.push({ collection: record.collection, documentId: record.id, reason: "Missing after write." });
        else if (documentHash(document.data() || {}) !== record.hash) verificationFailures.push({ collection: record.collection, documentId: record.id, reason: "Hash differs after write." });
      }
    }
    const protectedAfterCounts: Record<string, number> = {};
    if (options.execute) for (const collection of PROTECTED_COLLECTIONS) protectedAfterCounts[collection] = await countCollection(destination, collection);
    const safeToExecute = preflightSafe && !options.execute || (preflightSafe && options.execute && failures.length === 0 && writeConflicts.length === 0 && verificationFailures.length === 0);
    const report = {
      format: "fika.fika-os.batch1-migration-report.v1",
      runId, timestamp: new Date().toISOString(), dryRun: !options.execute, writesPerformed: writeResults.filter(result => result.outcome === "CREATE").length,
      source: { exportPath: sourcePath, fingerprint: sourceFingerprint, projectId: "fika-os-local", database: DESTINATION_DATABASE, metadata: sourceMetadata },
      destination: { projectId: DESTINATION_PROJECT, database: DESTINATION_DATABASE, runtimeMode: "staging" },
      allowlist: { canonicalEntityTypes: [...CORE_ENTITY_TYPES], provenanceCollections: [...PROVENANCE_COLLECTIONS], sourceCollection: "integrationHubCanonical" },
      protectedCollections: [...PROTECTED_COLLECTIONS],
      selected: { coreCanonical: Object.fromEntries(CORE_ENTITY_TYPES.map(type => [type, selected.core.filter(record => record.entityType === type).length])), coreTotal: selected.core.length, documentIds: selectedRecords.map(record => ({ collection: record.collection, id: record.id, canonicalId: record.canonicalId, entityType: record.entityType, sourceHash: record.hash })), provenanceCounts: Object.fromEntries(PROVENANCE_COLLECTIONS.map(collection => [collection, selected.provenance.filter(record => record.collection === collection).length])) },
      expected: { coreCanonical: EXPECTED_CORE_COUNTS, coreTotal: Object.values(EXPECTED_CORE_COUNTS).reduce((total, count) => total + count, 0) },
      sourceCoreDiagnostics,
      sourceOplocRecords,
      destinationBeforeCounts,
      protectedBeforeCounts,
      outcomes: options.execute ? { create: writeResults.filter(item => item.outcome === "CREATE").length, identicalSkip: outcomes.filter(item => item.outcome === "IDENTICAL_SKIP").length, conflict: conflicts.length + writeConflicts.length, protectedSkip: outcomes.filter(item => item.outcome === "PROTECTED_SKIP").length, failure: failures.length } : { create: outcomes.filter(item => item.outcome === "CREATE").length, identicalSkip: outcomes.filter(item => item.outcome === "IDENTICAL_SKIP").length, conflict: conflicts.length, protectedSkip: outcomes.filter(item => item.outcome === "PROTECTED_SKIP").length },
      conflicts: [...conflicts.map(item => ({ collection: item.record.collection, documentId: item.record.id, sourceHash: item.record.hash, destinationHash: item.destinationHash, differences: item.differences })), ...writeConflicts.map(item => ({ collection: item.record.collection, documentId: item.record.id, sourceHash: item.record.hash, destinationHash: item.destinationHash, differences: [item.error || "Conflict after preflight."] }))],
      failures: [...failures.map(item => ({ collection: item.record.collection, documentId: item.record.id, error: item.error })), ...verificationFailures],
      validation: { failureCount: validationFailures, issues: referenceIssues, acceptedEnvironmentWarningCount: environmentWarnings.filter(isAcceptedEnvironmentWarning).length, blockingEnvironmentWarningCount: acceptedWarningFailures.length },
      environmentWarnings: { count: environmentWarnings.length, byKind: warningCounts, warnings: environmentWarnings },
      destinationAfterCounts: options.execute ? Object.fromEntries(await Promise.all(["integrationHubCanonical", ...PROVENANCE_COLLECTIONS].map(async collection => [collection, await countCollection(destination, collection)]))) : undefined,
      protectedAfterCounts: options.execute ? protectedAfterCounts : undefined,
      verification: options.execute ? { failureCount: verificationFailures.length, selectedRecordsVerified: verificationFailures.length === 0 ? selectedRecords.length : selectedRecords.length - verificationFailures.length } : undefined,
      expectedSourceFingerprint: expectedFingerprint,
      fingerprintBeforeExecution,
      safeToExecute,
      SAFE_TO_EXECUTE: safeToExecute ? "YES" : "NO",
    };
    const reportPath = path.join(os.tmpdir(), `fika-batch1-${runId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath };
  } finally {
    if (source) await stopSource(source.child, source.app);
    for (const app of getApps().filter(candidate => candidate.name.startsWith("fika-batch1-destination-"))) await deleteApp(app).catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith("migrate-batch1.ts")) {
  const execute = process.argv.includes("--execute");
  const sourceArgIndex = process.argv.indexOf("--source-export");
  const expectedFingerprintArgIndex = process.argv.indexOf("--expected-fingerprint");
  const expectedFingerprint = expectedFingerprintArgIndex >= 0 ? process.argv[expectedFingerprintArgIndex + 1] : undefined;
  const sourceExport = sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : undefined;
  runDryRun({ sourceExport, execute, expectedFingerprint }).then(({ report, reportPath }) => {
    console.log(JSON.stringify({
      reportPath,
      source: report.source,
      destination: report.destination,
      selected: { coreCanonical: report.selected.coreCanonical, coreTotal: report.selected.coreTotal, provenanceCounts: report.selected.provenanceCounts },
      destinationBeforeCounts: report.destinationBeforeCounts,
      outcomes: report.outcomes,
      failures: report.failures,
      validation: { failureCount: report.validation.failureCount },
      environmentWarnings: { count: report.environmentWarnings.count, byKind: report.environmentWarnings.byKind },
      writesPerformed: report.writesPerformed,
      SAFE_TO_EXECUTE: report.SAFE_TO_EXECUTE,
    }, null, 2));
    process.exitCode = report.SAFE_TO_EXECUTE === "YES" ? 0 : 2;
  }).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
