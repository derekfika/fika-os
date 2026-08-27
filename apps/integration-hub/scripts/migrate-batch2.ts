import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  assertDestinationSafety, assertSourceExport, countCollection, documentHash, EXPECTED_SOURCE_FINGERPRINT,
  findEnvironmentWarnings, flattenStrings, isAcceptedEnvironmentWarning, isProtectedCollection, PROTECTED_COLLECTIONS,
  PROVENANCE_COLLECTIONS, readCollection, SOURCE_EXPORT, startSource, stopSource, type ReferenceIssue, type SelectedRecord,
  writeSelectedRecords,
} from "./migrate-batch1";

const BATCH1_ENTITY_TYPES = new Set(["OPLOC", "Address", "Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price"]);
const EXPECTED_REMAINING: Record<string, number> = {
  Legend: 176, Employment: 176, Site: 18, "Site Role Assignment": 76, "Site Staffing Requirement": 68,
  "Staffing Role": 28, "Product Category": 113, "Operational Area": 6, "Service Arrangement": 15,
  "Service Definition": 3, "Operational Area Type": 3, "Equipment Type": 4, "Equipment Asset": 1,
  "Hospitality Brochure Candidate": 43, "Hospitality Brochure Import": 1,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_REMAINING).reduce((sum, count) => sum + count, 0);

function selectBatch2(canonicalDocs: QueryDocumentSnapshot[], provenanceDocs: Record<typeof PROVENANCE_COLLECTIONS[number], QueryDocumentSnapshot[]>) {
  const core = canonicalDocs.flatMap(document => {
    const data = document.data();
    const entityType = String(data.entityType || "");
    if (!entityType || BATCH1_ENTITY_TYPES.has(entityType)) return [];
    return [{ collection: "integrationHubCanonical" as const, id: document.id, canonicalId: String(data.canonicalId || ""), entityType, data, hash: documentHash(data) }];
  });
  const selectedIds = new Set(core.map(record => record.canonicalId).filter(Boolean));
  const provenance = (Object.entries(provenanceDocs) as Array<[typeof PROVENANCE_COLLECTIONS[number], QueryDocumentSnapshot[]]>).flatMap(([collection, docs]) => docs.flatMap(document => {
    const data = document.data();
    if (!flattenStrings(data).some(item => selectedIds.has(item.value))) return [];
    return [{ collection, id: document.id, canonicalId: typeof data.canonicalId === "string" ? data.canonicalId : undefined, entityType: typeof data.entityType === "string" ? data.entityType : undefined, data, hash: documentHash(data) }];
  }));
  return { core, provenance, selectedIds };
}

function validateBatch2References(records: SelectedRecord[], allCanonical: QueryDocumentSnapshot[], batch1Ids: Set<string>): ReferenceIssue[] {
  const selected = new Set(records.filter(record => record.collection === "integrationHubCanonical").map(record => record.canonicalId).filter(Boolean));
  const all = new Set(allCanonical.map(document => String(document.data().canonicalId || "")).filter(Boolean));
  const allowed = new Set([...selected, ...batch1Ids]);
  const issues: ReferenceIssue[] = [];
  for (const record of records.filter(item => item.collection === "integrationHubCanonical")) {
    for (const { field, value } of flattenStrings(record.data)) {
      if (!/reference|oploc|address|menuitem|offering|price|canonicalid|target|site|legend|employment|staffing|service|equipment|category|area|brochure/i.test(field)) continue;
      if (!/^(oploc:|address:|hospitality-menu-item:|hospitality-menu-offering:|hospitality-menu-price:|site:|legend:|employment:|staffing-|service-|equipment-|product-category:|operational-area:|brochure-)/i.test(value)) continue;
      if (!all.has(value)) issues.push({ collection: record.collection, documentId: record.id, field, value, kind: "MISSING" });
      else if (!allowed.has(value)) issues.push({ collection: record.collection, documentId: record.id, field, value, kind: "EXCLUDED" });
    }
  }
  return issues;
}

function summarizeEntityCounts(records: SelectedRecord[]) {
  return records.filter(record => record.collection === "integrationHubCanonical").reduce<Record<string, number>>((counts, record) => {
    counts[record.entityType || "<missing>"] = (counts[record.entityType || "<missing>"] || 0) + 1;
    return counts;
  }, {});
}

export async function runBatch2(options: { sourceExport?: string; execute?: boolean; expectedFingerprint?: string } = {}) {
  const sourcePath = assertSourceExport(options.sourceExport || SOURCE_EXPORT);
  assertDestinationSafety();
  const expectedFingerprint = options.expectedFingerprint || EXPECTED_SOURCE_FINGERPRINT;
  const fingerprintDirectory = (root: string) => {
    const sourceFingerprint = crypto.createHash("sha256");
    const files: string[] = [];
    const walk = (directory: string) => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(entry => { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else files.push(target); });
    walk(root);
    for (const file of files) { const relative = path.relative(root, file).replaceAll("\\", "/"); const bytes = fs.readFileSync(file); sourceFingerprint.update(relative).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0"); }
    return sourceFingerprint.digest("hex");
  };
  const fingerprint = fingerprintDirectory(sourcePath);
  if (fingerprint !== expectedFingerprint) throw new Error(`Source fingerprint mismatch. Expected ${expectedFingerprint}, got ${fingerprint}.`);
  let source: Awaited<ReturnType<typeof startSource>> | undefined;
  try {
    source = await startSource(sourcePath);
    const destinationApp = initializeApp({ projectId: "fika-os-dev" }, `fika-batch2-destination-${process.pid}`);
    const destination = getFirestore(destinationApp);
    const canonical = await readCollection(source.db, "integrationHubCanonical");
    const provenanceDocs = { integrationHubCanonicalRevisions: await readCollection(source.db, "integrationHubCanonicalRevisions"), integrationHubSourceMappings: await readCollection(source.db, "integrationHubSourceMappings"), integrationHubGovernanceAudit: await readCollection(source.db, "integrationHubGovernanceAudit") };
    const selected = selectBatch2(canonical, provenanceDocs);
    const batch1Ids = new Set(canonical.filter(document => BATCH1_ENTITY_TYPES.has(String(document.data().entityType))).map(document => String(document.data().canonicalId || "")).filter(Boolean));
    const selectedRecords = [...selected.core, ...selected.provenance];
    const referenceIssues = validateBatch2References(selectedRecords, canonical, batch1Ids);
    const environmentWarnings = findEnvironmentWarnings(selectedRecords);
    const blockingWarnings = environmentWarnings.filter(warning => !isAcceptedEnvironmentWarning(warning));
    const beforeCounts: Record<string, number> = {};
    for (const collection of ["integrationHubCanonical", ...PROVENANCE_COLLECTIONS]) beforeCounts[collection] = await countCollection(destination, collection);
    const protectedBefore: Record<string, number> = {};
    for (const collection of PROTECTED_COLLECTIONS) protectedBefore[collection] = await countCollection(destination, collection);
    const outcomes: Array<{ outcome: string; record: SelectedRecord; destinationHash?: string; differences?: string[] }> = [];
    for (const record of selectedRecords) {
      if (isProtectedCollection(record.collection)) { outcomes.push({ outcome: "PROTECTED_SKIP", record }); continue; }
      const existing = await destination.collection(record.collection).doc(record.id).get();
      if (!existing.exists) outcomes.push({ outcome: "CREATE", record });
      else { const destinationHash = documentHash(existing.data() || {}); outcomes.push(destinationHash === record.hash ? { outcome: "IDENTICAL_SKIP", record, destinationHash } : { outcome: "CONFLICT", record, destinationHash, differences: ["Content differs from source."] }); }
    }
    const conflicts = outcomes.filter(item => item.outcome === "CONFLICT");
    const brokenReferences = referenceIssues.filter(issue => issue.kind === "MISSING");
    const preflightSafe = conflicts.length === 0 && brokenReferences.length === 0 && blockingWarnings.length === 0;
    const fingerprintBeforeExecution = options.execute ? fingerprintDirectory(sourcePath) : undefined;
    if (options.execute && fingerprintBeforeExecution !== expectedFingerprint) throw new Error(`Source fingerprint changed before execution. Expected ${expectedFingerprint}, got ${fingerprintBeforeExecution}.`);
    const writes = options.execute && preflightSafe ? await writeSelectedRecords(destination, outcomes.filter(item => item.outcome === "CREATE").map(item => item.record)) : [];
    const failures = writes.filter(item => item.outcome === "FAILURE");
    const writeConflicts = writes.filter(item => item.outcome === "CONFLICT");
    const verificationFailures: Array<{ collection: string; documentId: string; reason: string }> = [];
    if (options.execute && preflightSafe) for (const record of selectedRecords) { const document = await destination.collection(record.collection).doc(record.id).get(); if (!document.exists) verificationFailures.push({ collection: record.collection, documentId: record.id, reason: "Missing after write." }); else if (documentHash(document.data() || {}) !== record.hash) verificationFailures.push({ collection: record.collection, documentId: record.id, reason: "Hash differs after write." }); }
    const afterCounts: Record<string, number> = {};
    const afterCanonical = options.execute ? await readCollection(destination, "integrationHubCanonical") : [];
    if (options.execute) for (const collection of ["integrationHubCanonical", ...PROVENANCE_COLLECTIONS]) afterCounts[collection] = await countCollection(destination, collection);
    const protectedAfter: Record<string, number> = {};
    if (options.execute) for (const collection of PROTECTED_COLLECTIONS) protectedAfter[collection] = await countCollection(destination, collection);
    const report = { format: "fika.fika-os.batch2-migration-report.v1", runId: crypto.randomUUID(), timestamp: new Date().toISOString(), dryRun: !options.execute, writesPerformed: writes.filter(item => item.outcome === "CREATE").length, source: { exportPath: sourcePath, fingerprint, projectId: "fika-os-local", database: "(default)" }, destination: { projectId: "fika-os-dev", database: "(default)", runtimeMode: "staging" }, selected: { canonicalByEntityType: summarizeEntityCounts(selectedRecords), canonicalTotal: selected.core.length, provenanceCounts: Object.fromEntries(PROVENANCE_COLLECTIONS.map(collection => [collection, selected.provenance.filter(record => record.collection === collection).length])) }, expected: { remainingCanonicalByEntityType: EXPECTED_REMAINING, remainingCanonicalTotal: EXPECTED_TOTAL }, destinationBeforeCounts: beforeCounts, destinationAfterCounts: options.execute ? afterCounts : undefined, outcomes: options.execute ? { create: writes.filter(item => item.outcome === "CREATE").length, identicalSkip: outcomes.filter(item => item.outcome === "IDENTICAL_SKIP").length, conflict: conflicts.length + writeConflicts.length, protectedSkip: outcomes.filter(item => item.outcome === "PROTECTED_SKIP").length, failure: failures.length } : { create: outcomes.filter(item => item.outcome === "CREATE").length, identicalSkip: outcomes.filter(item => item.outcome === "IDENTICAL_SKIP").length, conflict: conflicts.length, protectedSkip: outcomes.filter(item => item.outcome === "PROTECTED_SKIP").length }, conflicts: [...conflicts, ...writeConflicts].map(item => ({ collection: item.record.collection, documentId: item.record.id, differences: (item as { differences?: string[] }).differences })), failures: [...failures.map(item => ({ collection: item.record.collection, documentId: item.record.id, error: item.error })), ...verificationFailures], validation: { brokenReferenceCount: brokenReferences.length, unresolvedCandidateOrReviewReferenceCount: referenceIssues.filter(issue => issue.kind === "EXCLUDED").length, issues: referenceIssues, environmentWarningCount: environmentWarnings.length, blockingEnvironmentWarningCount: blockingWarnings.length, secretsDetected: environmentWarnings.filter(warning => warning.kind === "credential-like field").length }, protectedBefore, protectedAfter: options.execute ? protectedAfter : undefined, finalCanonicalByEntityType: options.execute ? summarizeEntityCounts(afterCanonical.map(document => ({ collection: "integrationHubCanonical", id: document.id, data: document.data(), hash: documentHash(document.data()), entityType: String(document.data().entityType || "") }))) : undefined, verification: options.execute ? { hashFailureCount: verificationFailures.length, selectedRecordsVerified: selectedRecords.length - verificationFailures.length } : undefined, safeToExecute: preflightSafe && (!options.execute || (failures.length === 0 && writeConflicts.length === 0 && verificationFailures.length === 0)), SAFE_TO_EXECUTE: preflightSafe && (!options.execute || (failures.length === 0 && writeConflicts.length === 0 && verificationFailures.length === 0)) ? "YES" : "NO" };
    const reportPath = path.join(os.tmpdir(), `fika-batch2-${report.runId}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath };
  } finally {
    if (source) await stopSource(source.child, source.app);
    for (const app of getApps().filter(candidate => candidate.name.startsWith("fika-batch2-destination-"))) await deleteApp(app).catch(() => undefined);
  }
}

if (process.argv[1]?.endsWith("migrate-batch2.ts")) {
  const execute = process.argv.includes("--execute");
  const sourceIndex = process.argv.indexOf("--source-export");
  const fingerprintIndex = process.argv.indexOf("--expected-fingerprint");
  runBatch2({ sourceExport: sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined, expectedFingerprint: fingerprintIndex >= 0 ? process.argv[fingerprintIndex + 1] : undefined, execute }).then(({ report, reportPath }) => { console.log(JSON.stringify({ reportPath, source: report.source, destination: report.destination, selected: report.selected, destinationBeforeCounts: report.destinationBeforeCounts, outcomes: report.outcomes, failures: report.failures, validation: report.validation, writesPerformed: report.writesPerformed, SAFE_TO_EXECUTE: report.SAFE_TO_EXECUTE }, null, 2)); process.exitCode = report.SAFE_TO_EXECUTE === "YES" ? 0 : 2; }).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
