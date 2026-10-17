import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DESTINATION_PROJECT,
  SOURCE_PROJECT,
  buildPlan,
  planPolicy,
  verifyApprovedPlan,
} from "./engine.mjs";
import { runGovernedApply } from "./governed-apply.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const output = arg("--output") || path.join(tmpdir(), "fika-firestore-bootstrap-plan.json");

function accessToken() {
  if (process.env.FIKA_ACCESS_TOKEN) return process.env.FIKA_ACCESS_TOKEN;
  if (process.platform === "win32") return execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "gcloud auth print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
    const query = new URLSearchParams({ pageSize: "1000", showMissing: "true", ...(pageToken ? { pageToken } : {}) });
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
  const placeholders = [];
  while (collectionQueue.length) {
    const batch = collectionQueue.splice(0, concurrency);
    const children = await Promise.all(batch.map(async collectionPath => {
      if (collectionPaths.has(collectionPath)) return [];
      collectionPaths.add(collectionPath);
      const docs = await listDocuments(project, collectionPath);
      const childCollections = await mapLimit(docs, async document => {
        const marker = "/documents/";
        const documentPath = document.name.slice(document.name.indexOf(marker) + marker.length);
        const missing = document.fields === undefined && document.createTime === undefined && document.updateTime === undefined;
        if (missing) placeholders.push({ path: documentPath });
        else records.push({ path: documentPath, fields: document.fields || {}, updateTime: document.updateTime || null });
        const nested = await listCollectionIds(project, documentPath);
        return nested.map(id => `${documentPath}/${id}`);
      });
      return childCollections.flat();
    }));
    collectionQueue.push(...children.flat());
  }
  records.sort((a, b) => a.path.localeCompare(b.path));
  placeholders.sort((a, b) => a.path.localeCompare(b.path));
  return { project, generatedAt: new Date().toISOString(), collectionCount: collectionPaths.size, documentCount: records.length, placeholderCount: placeholders.length, placeholders, records };
}

async function saveJournalAtomic(journalPath, journal) {
  await mkdir(path.dirname(journalPath), { recursive: true });
  try { if ((await lstat(journalPath)).isSymbolicLink()) throw new Error("Refusing a symlink journal path."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const tempPath = `${journalPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(journal, null, 2), { flag: "wx", mode: 0o600 });
  await rename(tempPath, journalPath);
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
  const approvedPlan = verifyApprovedPlan(saved, { apply, planHash: arg("--plan-hash") }, process.env);
  destination = await inventory(DESTINATION_PROJECT);
  const journalRoot = path.join(process.env.LOCALAPPDATA || tmpdir(), "FIKA", "firestore-bootstrap", "journals");
  const journalPath = path.join(journalRoot, `${approvedPlan.planHash}.json`);
  let journal;
  let journalPresent = false;
  try {
    const journalStat = await lstat(journalPath);
    if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw new Error("Refusing a journal path that is not a regular local file.");
    journal = JSON.parse(await readFile(journalPath, "utf8"));
    journalPresent = true;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const result = await runGovernedApply({
    savedPlan: approvedPlan,
    args: { apply, planHash: arg("--plan-hash") },
    env: process.env,
    sourceInventory: source,
    destinationInventory: destination,
    journal,
    journalPresent,
    adapters: {
    readSource: documentPath => readDocument(SOURCE_PROJECT, documentPath),
    readDestination: documentPath => readDocument(DESTINATION_PROJECT, documentPath),
    createDestination: createDocument,
    },
    async refreshSourceInventory() { return inventory(SOURCE_PROJECT); },
    async refreshDestinationInventory() { return inventory(DESTINATION_PROJECT); },
    async persistJournal(value) { await saveJournalAtomic(journalPath, value); },
  });
  console.log(JSON.stringify({ mode: "apply", planHash: result.planHash, verifiedResume: result.verifiedResume, finalDestinationVerification: result.finalDestinationVerification, journalPath }, null, 2));
} else {
  destination = await inventory(DESTINATION_PROJECT);
  const plan = buildPlan(source, destination);
  const report = { ...plan, inventoryGeneratedAt: source.generatedAt, sourceCollectionCount: source.collectionCount, destinationCollectionCount: destination.collectionCount, policy: planPolicy };
  await writeFile(output, JSON.stringify(plan, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ mode: "dry-run", inventoryGeneratedAt: source.generatedAt, sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT, sourceDocumentCount: plan.sourceDocumentCount, destinationDocumentCount: plan.destinationDocumentCount, sourceCollectionCount: source.collectionCount, destinationCollectionCount: destination.collectionCount, sourcePlaceholderCount: source.placeholderCount, destinationPlaceholderCount: destination.placeholderCount, retainedCount: plan.retainedCount, excludedCount: plan.excludedCount, retainedByRoot: plan.retainedByRoot, excludedByReason: plan.excludedByReason, transformedByRule: plan.transformedByRule, invariantProblems: plan.invariantProblems, planHash: plan.planHash, sourceHash: plan.sourceHash, planPath: output, policy: report.policy }, null, 2));
}
