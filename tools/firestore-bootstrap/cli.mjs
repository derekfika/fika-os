import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DESTINATION_PROJECT,
  SOURCE_PROJECT,
  applyPlan,
  assertApproval,
  buildPlan,
  planPolicy,
  sourceStateHash,
  validateResumableDestination,
} from "./engine.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const output = arg("--output") || path.join(tmpdir(), "fika-firestore-bootstrap-plan.json");
const journalPath = arg("--journal") || path.join(tmpdir(), "fika-firestore-bootstrap-journal.json");

function accessToken() {
  if (process.env.FIKA_ACCESS_TOKEN) return process.env.FIKA_ACCESS_TOKEN;
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const token = accessToken();
const concurrency = 12;
async function request(project, method, url, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": project },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (response.ok) return response.status === 204 ? {} : response.json();
    const details = (await response.text()).slice(0, 400);
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      continue;
    }
    throw new Error(`${project} Firestore ${response.status}: ${details}`);
  }
  throw new Error(`${project} Firestore retry budget exhausted.`);
}

const encodePath = value => value.split("/").map(encodeURIComponent).join("/");
async function listCollectionIds(project, documentPath) {
  let result = [];
  let pageToken;
  do {
    const parent = documentPath ? `/${encodePath(documentPath)}` : "";
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const value = await request(project, "POST", `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents${parent}:listCollectionIds?${query}`, { pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
    result.push(...(value.collectionIds || []));
    pageToken = value.nextPageToken;
  } while (pageToken);
  return result;
}

async function listDocuments(project, collectionPath) {
  let documents = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const value = await request(project, "GET", `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${encodePath(collectionPath)}?${query}`);
    documents.push(...(value.documents || []));
    pageToken = value.nextPageToken;
  } while (pageToken);
  return documents;
}

async function mapLimit(values, fn) {
  const result = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      result[index] = await fn(values[index]);
    }
  }));
  return result;
}

async function inventory(project) {
  const collectionQueue = await listCollectionIds(project, "");
  const collectionPaths = new Set();
  const records = [];
  while (collectionQueue.length) {
    const batch = collectionQueue.splice(0, concurrency);
    const children = await Promise.all(batch.map(async collectionPath => {
      if (collectionPaths.has(collectionPath)) return [];
      collectionPaths.add(collectionPath);
      const docs = await listDocuments(project, collectionPath);
      const childCollections = await mapLimit(docs, async document => {
        const marker = "/documents/";
        const documentPath = document.name.slice(document.name.indexOf(marker) + marker.length);
        records.push({ path: documentPath, fields: document.fields || {}, updateTime: document.updateTime || null });
        const nested = await listCollectionIds(project, documentPath);
        return nested.map(id => `${documentPath}/${id}`);
      });
      return childCollections.flat();
    }));
    collectionQueue.push(...children.flat());
  }
  records.sort((a, b) => a.path.localeCompare(b.path));
  return { project, generatedAt: new Date().toISOString(), collectionCount: collectionPaths.size, documentCount: records.length, records };
}

async function readDocument(project, documentPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${encodePath(documentPath)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${project} Firestore read ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const document = await response.json();
  return { path: document.name.split("/documents/")[1], fields: document.fields || {}, updateTime: document.updateTime || null };
}

async function createDocument(documentPath, fields) {
  const name = `projects/${DESTINATION_PROJECT}/databases/(default)/documents/${documentPath}`;
  const result = await request(DESTINATION_PROJECT, "POST", `https://firestore.googleapis.com/v1/projects/${DESTINATION_PROJECT}/databases/(default)/documents:commit`, {
    writes: [{ update: { name, fields }, currentDocument: { exists: false } }],
  });
  return result;
}

const source = await inventory(SOURCE_PROJECT);
let destination;
let saved;
if (apply) {
  saved = JSON.parse(await readFile(arg("--plan") || output, "utf8"));
  if (saved.destinationBaseline.length) throw new Error("This copier requires an initially empty production Firestore; non-empty destination bootstrap is unsupported.");
  destination = await inventory(DESTINATION_PROJECT);
} else destination = await inventory(DESTINATION_PROJECT);
const plan = buildPlan(source, apply ? { project: DESTINATION_PROJECT, records: [] } : destination);
if (apply) {
  if (saved.planHash !== plan.planHash || saved.sourceHash !== plan.sourceHash || sourceStateHash(source) !== saved.sourceHash) throw new Error("Fresh source state does not match the reviewed plan. Re-inventory and review before proceeding.");
  assertApproval(plan, { apply, planHash: arg("--plan-hash") }, process.env);
  const resume = validateResumableDestination(saved, destination);
  let journal = {};
  try { journal = JSON.parse(await readFile(journalPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (journal.planHash && journal.planHash !== saved.planHash) throw new Error("The resumable journal belongs to a different plan hash.");
  await applyPlan(saved, {
    readSource: documentPath => readDocument(SOURCE_PROJECT, documentPath),
    readDestination: documentPath => readDocument(DESTINATION_PROJECT, documentPath),
    createDestination,
    async saveJournal(value) { await writeFile(journalPath, JSON.stringify({ planHash: saved.planHash, completed: value }, null, 2), { mode: 0o600 }); },
  }, journal.completed || journal);
  const sourceAfter = await inventory(SOURCE_PROJECT);
  if (sourceStateHash(sourceAfter) !== saved.sourceHash) throw new Error("Source changed during apply. The completed journal is preserved; stop and review before any retry.");
  console.log(JSON.stringify({ mode: "apply", planHash: saved.planHash, verifiedResume: resume, journalPath }, null, 2));
} else {
  const report = { ...plan, inventoryGeneratedAt: source.generatedAt, sourceCollectionCount: source.collectionCount, destinationCollectionCount: destination.collectionCount, policy: planPolicy };
  await writeFile(output, JSON.stringify(plan, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: "dry-run", inventoryGeneratedAt: source.generatedAt, sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT, sourceDocumentCount: plan.sourceDocumentCount, destinationDocumentCount: plan.destinationDocumentCount, retainedCount: plan.retainedCount, excludedCount: plan.excludedCount, retainedByRoot: plan.retainedByRoot, excludedByReason: plan.excludedByReason, transformedByRule: plan.transformedByRule, invariantProblems: plan.invariantProblems, planHash: plan.planHash, sourceHash: plan.sourceHash, planPath: output, policy: report.policy }, null, 2));
}
