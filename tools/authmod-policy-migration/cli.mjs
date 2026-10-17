import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COLLECTIONS, DEREK_IDENTITY, DESTINATION_PROJECT, SOURCE_PROJECT, assertProductionApplyEnvironment,
  buildMigrationPlan, classifyExistingMigration, createOnlyWrites, materializeAtApply, sha256, verifyMigrationApproval,
} from "./engine.mjs";

const args = process.argv.slice(2);
const has = value => args.includes(value);
const arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const applying = has("--apply");
const defaultOutput = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "FIKA", "authmod-production-migration", "approved-plan.json");
const planPath = arg("--plan") || defaultOutput;
if (applying) assertProductionApplyEnvironment({ runtimeMode: process.env.FIKA_RUNTIME_MODE, sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT });

function token() {
  if (process.env.FIKA_ACCESS_TOKEN) return process.env.FIKA_ACCESS_TOKEN;
  return execFileSync(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "gcloud", process.platform === "win32" ? ["/d", "/s", "/c", "gcloud auth print-access-token"] : ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const accessToken = token();

function decode(value) {
  if (!value || typeof value !== "object") return value;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decode(child)]));
  return value;
}
function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === "object" && value.setToServerValue) return { timestampValue: value.setToServerValue };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) } };
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}
const fieldValues = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
const pathFromName = name => name.split("/documents/")[1];

async function request(project, method, url, body) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "x-goog-user-project": project }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${project} Firestore ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.status === 204 ? {} : response.json();
}
async function list(project, collection) {
  const result = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const page = await request(project, "GET", `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}?${query}`);
    for (const document of page.documents || []) result.push({ path: pathFromName(document.name), fields: fieldValues(document.fields), updateTime: document.updateTime || null });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return result;
}
async function collect() {
  const [policy, identities, applications, canonical] = await Promise.all([
    Promise.all(Object.values(COLLECTIONS).map(collection => list(SOURCE_PROJECT, collection))).then(groups => groups.flat()),
    list(DESTINATION_PROJECT, "authmodIdentities"),
    list(DESTINATION_PROJECT, "authmodApplications"),
    list(DESTINATION_PROJECT, "integrationHubCanonical"),
  ]);
  const productionPolicy = (await Promise.all(Object.values(COLLECTIONS).map(collection => list(DESTINATION_PROJECT, collection)))).flat();
  const destinations = {
    identities: await list(DESTINATION_PROJECT, "authmodIdentities"),
    applications: await list(DESTINATION_PROJECT, "authmodApplications"),
    policy: productionPolicy,
    receipts: await list(DESTINATION_PROJECT, "authmodAccessAudit"),
  };
  const employmentByLegend = new Map();
  for (const employment of canonical.filter(value => value.fields.entityType === "Employment" && value.fields.lifecycleStatus !== "archived")) {
    const legendId = String(employment.fields.record?.legendId || "");
    if (!legendId) continue;
    const list = employmentByLegend.get(legendId) || [];
    list.push(employment.fields.record || {});
    employmentByLegend.set(legendId, list);
  }
  const activeOplocs = canonical.filter(value => value.fields.entityType === "OPLOC" && value.fields.canonicalId && value.fields.lifecycleStatus !== "archived" && value.fields.publicationStatus !== "withdrawn" && String(value.fields.record?.lifecycleState || "active") === "active").map(value => value.fields.canonicalId);
  const legends = canonical.filter(value => value.fields.entityType === "Legend" && value.fields.canonicalId && value.fields.lifecycleStatus !== "archived" && (() => {
    const employments = employmentByLegend.get(value.fields.canonicalId) || [];
    if (employments.length) return employments.some(item => !["terminated", "ended", "inactive", "left"].includes(String(item.employmentState || "").trim().toLowerCase()) && !item.terminationDate);
    return value.fields.record?.active !== false && !["terminated", "ended", "inactive", "left"].includes(String(value.fields.record?.employmentState || "").trim().toLowerCase());
  })()).map(value => value.fields.canonicalId);
  const identityFields = identities.map(value => value.fields);
  const derekIdentity = identityFields.find(value => value.id === "authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7");
  const referenceContextHash = sha256({ identities: identities.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })), applications: applications.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })), canonical: canonical.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })) });
  return {
    policy,
    references: { identities: identityFields.map(value => value.id), allIdentities: identityFields, derekIdentity, applications: applications.map(value => value.fields.appId || value.path.split("/").at(-1)), applicationDefinitions: applications.map(value => value.fields), oplocs: activeOplocs, legends },
    sourceContext: { productionIdentityCount: destinations.identities.length, productionApplicationCount: destinations.applications.length, productionReferenceStateHash: referenceContextHash, executionOperatorEmail: activeOperatorEmail() },
    destinations,
  };
}
async function currentProductionReferenceStateHash() {
  const [identities, applications, canonical] = await Promise.all([
    list(DESTINATION_PROJECT, "authmodIdentities"),
    list(DESTINATION_PROJECT, "authmodApplications"),
    list(DESTINATION_PROJECT, "integrationHubCanonical"),
  ]);
  return {
    hash: sha256({ identities: identities.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })), applications: applications.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })), canonical: canonical.map(({ path, fields, updateTime }) => ({ path, fields, updateTime })) }),
    identities: identities.length,
    applications: applications.length,
  };
}
function activeOperatorEmail() {
  return execFileSync(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "gcloud", process.platform === "win32" ? ["/d", "/s", "/c", "gcloud auth list --filter=status:ACTIVE --format=value(account)"] : ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const live = await collect();
if (!applying) {
  const asOf = new Date().toISOString();
  const actorId = process.env.FIKA_AUTHMOD_MIGRATION_ACTOR || DEREK_IDENTITY;
  const generated = buildMigrationPlan({ sourceRecords: live.policy, productionReferences: live.references, asOf, actorId, sourceContext: live.sourceContext });
  const savedPlan = { body: generated.body, planHash: generated.planHash };
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(savedPlan, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode: "dry-run", planPath, sourceAnalysisHash: generated.analysisHash, sourceStateHash: generated.sourceStateHash, planHash: generated.planHash, portableRecords: generated.portable.length, freshDerekRecords: generated.freshDerek.map(value => value.path), excludedSpecialGrants: generated.special.map(value => value.path), productionBaseline: { identities: live.destinations.identities.length, applications: live.destinations.applications.length, policyDocuments: live.destinations.policy.length } }, null, 2));
  process.exit(0);
}

const suppliedPlanHash = arg("--plan-hash");
const approvedHash = process.env.FIKA_AUTHMOD_PRODUCTION_MIGRATION_APPROVAL_HASH;
if (!suppliedPlanHash || !approvedHash) throw new Error("Production apply requires --plan-hash and FIKA_AUTHMOD_PRODUCTION_MIGRATION_APPROVAL_HASH.");
const saved = JSON.parse(await readFile(planPath, "utf8"));
const currentStateHash = sha256(live.policy.map(({ path, fields, updateTime = null }) => ({ path, fields, updateTime })).sort((a, b) => a.path.localeCompare(b.path)));
const destination = { identities: live.destinations.identities.length, applications: live.destinations.applications.length, policyDocuments: live.destinations.policy.length };
if (live.sourceContext.productionIdentityCount !== 19 || live.sourceContext.productionApplicationCount !== 7) throw new Error("Production AUTHMOD canonical baseline must contain 19 identities and 7 applications.");
const hash = saved.body && saved.planHash ? sha256(saved.body) : null;
const existing = live.destinations.policy;
const receiptPath = `${saved.body.auditReceipt.collection}/${saved.body.auditReceipt.documentId}`;
const receipt = live.destinations.receipts.find(value => value.path === receiptPath);
const operationTimestamp = receipt?.fields?.timestamp || new Date().toISOString();
const plannedWrites = createOnlyWrites(saved, saved.body.auditReceipt.executedBy, operationTimestamp);
const expectedAfter = plannedWrites.filter(value => value.path !== receiptPath);
const expectedReceipt = plannedWrites.find(value => value.path === receiptPath)?.fields;
if (existing.length || receipt) {
  const state = classifyExistingMigration({ existingPolicy: existing, expectedRecords: expectedAfter, receipt, expectedReceipt, planHash: hash, sourceStateHash: saved.body.sourceStateHash });
  if (state === "already-applied-exactly") {
    verifyMigrationApproval(saved, { planHash: suppliedPlanHash, approvalHash: approvedHash, currentSourceStateHash: currentStateHash, currentSourceContext: live.sourceContext, destination: { ...destination, policyDocuments: 0 } });
    console.log(JSON.stringify({ mode: "apply", result: "already-applied-exactly; no-op", planHash: hash, records: expectedAfter.length }, null, 2));
    process.exit(0);
  }
  throw new Error("Production AUTHMOD policy is non-empty or partially populated; refusing apply/retry without exact completed migration state.");
}
const verifiedHash = verifyMigrationApproval(saved, { planHash: suppliedPlanHash, approvalHash: approvedHash, currentSourceStateHash: currentStateHash, currentSourceContext: live.sourceContext, destination });
if (activeOperatorEmail() !== saved.body.sourceContext.executionOperatorEmail) throw new Error("Active Google operator differs from the operator bound into the approved plan.");
const refreshedPolicy = (await Promise.all(Object.values(COLLECTIONS).map(collection => list(SOURCE_PROJECT, collection)))).flat().sort((a, b) => a.path.localeCompare(b.path));
const refreshedStateHash = sha256(refreshedPolicy.map(({ path, fields, updateTime = null }) => ({ path, fields, updateTime })));
if (refreshedStateHash !== saved.body.sourceStateHash) throw new Error("Staging AUTHMOD source drift detected on final pre-write refresh.");
const refreshedReferences = await currentProductionReferenceStateHash();
if (refreshedReferences.hash !== saved.body.sourceContext.productionReferenceStateHash || refreshedReferences.identities !== 19 || refreshedReferences.applications !== 7) throw new Error("Production AUTHMOD references changed immediately before write; refusing apply.");
const refreshedDestinationPolicy = (await Promise.all(Object.values(COLLECTIONS).map(collection => list(DESTINATION_PROJECT, collection)))).flat();
if (refreshedDestinationPolicy.length !== 0) throw new Error("Production AUTHMOD policy changed immediately before write; refusing apply.");
const writes = createOnlyWrites({ ...saved, planHash: verifiedHash }, saved.body.auditReceipt.executedBy, operationTimestamp);
const firestoreWrites = writes.map(({ path, fields, currentDocument }) => ({
  update: { name: `projects/${DESTINATION_PROJECT}/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) },
  currentDocument,
}));
await request(DESTINATION_PROJECT, "POST", `https://firestore.googleapis.com/v1/projects/${DESTINATION_PROJECT}/databases/(default)/documents:commit`, { writes: firestoreWrites });
const verifiedDestination = (await Promise.all(Object.values(COLLECTIONS).map(collection => list(DESTINATION_PROJECT, collection)))).flat();
const expectedByPath = new Map(expectedAfter.map(value => [value.path, value.fields]));
const actualByPath = new Map(verifiedDestination.map(value => [value.path, value.fields]));
if (actualByPath.size !== expectedByPath.size || [...expectedByPath].some(([path, fields]) => !actualByPath.has(path) || sha256(actualByPath.get(path)) !== sha256(fields))) throw new Error("Post-migration production policy exact-set verification failed.");
const verifiedReceipt = (await list(DESTINATION_PROJECT, saved.body.auditReceipt.collection)).find(value => value.path === receiptPath);
if (!verifiedReceipt || sha256(verifiedReceipt.fields) !== sha256(expectedReceipt)) throw new Error("Post-migration production audit receipt verification failed.");
console.log(JSON.stringify({ mode: "apply", result: "committed", planHash: verifiedHash, createdPolicyDocuments: expectedAfter.length, auditReceipt: receiptPath, packageRegeneration: "required as a separate production-derived operation; not run by this migration" }, null, 2));
