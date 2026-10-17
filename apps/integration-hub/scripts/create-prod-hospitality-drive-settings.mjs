#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const projectId = "fika-os";
const databaseId = "(default)";
const operatorEmail = "derek@fikacatering.com";
const identityId = "authid:32fa3852-01d6-475f-bc7c-3204b3cdbdf7";
const settingsCollection = "fikaDashboardQuoteSettings";
const auditCollection = "integrationHubGovernanceAudit";
const apply = process.argv.includes("--apply");
const timestampArg = process.argv.slice(2).find((arg) => arg.startsWith("--updated-at="));
const updatedAtArg = timestampArg?.slice("--updated-at=".length);
const allowedArgs = new Set(["--apply", ...(timestampArg ? [timestampArg] : [])]);
if (process.argv.slice(2).some((arg) => !allowedArgs.has(arg)) || (updatedAtArg && (!Number.isFinite(Date.parse(updatedAtArg)) || new Date(updatedAtArg).toISOString() !== updatedAtArg))) {
  throw new Error("Usage: node scripts/create-prod-hospitality-drive-settings.mjs [--updated-at=ISO-8601] [--apply]");
}

function gcloud(args) {
  const executable = path.join(process.env.LOCALAPPDATA || "", "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.ps1");
  const command = `& '${executable.replaceAll("'", "''")}' ${args.map((value) => `'${String(value).replaceAll("'", "''")}'`).join(" ")}`;
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const activeAccount = gcloud(["config", "get-value", "account"]);
if (activeAccount.toLowerCase() !== operatorEmail) {
  throw new Error(`Refusing production configuration write: active gcloud account is ${activeAccount}, expected ${operatorEmail}.`);
}
const accessToken = gcloud(["auth", "print-access-token", `--account=${operatorEmail}`]);

const documentName = (collection, id) => `projects/${projectId}/databases/${databaseId}/documents/${collection}/${id}`;
const documentUrl = (collection, id) => `https://firestore.googleapis.com/v1/${documentName(collection, encodeURIComponent(id))}`;
async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.status || response.status;
    const error = new Error(`Firestore REST request failed (${code}): ${body?.error?.message || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  throw new Error("Unsupported Firestore value in read-back.");
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}
function encode(value) {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  throw new Error(`Cannot encode Firestore value of type ${typeof value}.`);
}
function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)]));
}
async function readDocument(collection, id) {
  try {
    const doc = await request(documentUrl(collection, id));
    return { exists: true, value: decodeFields(doc.fields || {}) };
  } catch (error) {
    if (error.status === 404) return { exists: false };
    throw error;
  }
}
function stableId(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function deepEqual(left, right) {
  const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

const identity = await readDocument("authmodIdentities", identityId);
if (!identity.exists || identity.value.id !== identityId || identity.value.identityKind !== "person" || identity.value.status !== "active" || identity.value.normalizedEmail !== operatorEmail || identity.value.externalProvider !== "firebase" || !identity.value.externalUid) {
  throw new Error("Refusing write: Derek's active production AUTHMOD identity and Firebase UID binding did not verify.");
}
if (identity.value.fullAccess !== false) throw new Error("Refusing write: expected Derek's production fullAccess flag to remain false.");
const grantRows = await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:runQuery`, {
  method: "POST",
  body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "authmodAuthorityGrants" }],
    where: { fieldFilter: { field: { fieldPath: "subjectId" }, op: "EQUAL", value: { stringValue: identityId } } },
  } }),
});
const nowMs = Date.now();
const hasEffectiveAdminister = grantRows.some(({ document }) => {
  if (!document) return false;
  const grant = decodeFields(document.fields || {});
  return grant.status === "active" && grant.subjectType === "interactive" && grant.appId === "integration-hub" && grant.resource === "authmod" && grant.action === "Administer" && grant.scope?.kind === "organisation" && (!grant.effectiveFrom || Date.parse(grant.effectiveFrom) <= nowMs) && (!grant.effectiveTo || Date.parse(grant.effectiveTo) >= nowMs);
});
if (!hasEffectiveAdminister) throw new Error("Refusing write: Derek lacks the live organisation-scoped Integration Hub Administer grant required by the existing settings route.");

const targets = [
  {
    dashboardId: "rcoa-hospitality",
    id: stableId("rcoa-hospitality"),
    oplocId: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2",
    settings: {
      dashboardId: "rcoa-hospitality",
      version: 2,
      managementFee: { mode: "fixed", value: 0, label: "Management fee" },
      deliveryCharge: { enabled: true, amount: 35, label: "CPU delivery charge" },
      labourRates: [
        { id: "chef", label: "Chef" },
        { id: "foh-assistant", label: "FOH Assistant" },
        { id: "kp", label: "KP" },
      ],
      vatRate: 0.2,
      updatedBy: identity.value.externalUid,
      googleQuoteFolderId: "1SMd9V_3wTwLAKpXJxj0VacDosRsJBFKR",
      googleMatrixFolderId: "1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X",
      googleMenuFolderId: "1dEY_-fr_MD1iZmIZ0hfzaDcBhpFPz1Ij",
    },
  },
  {
    dashboardId: "angel-court-hospitality",
    id: stableId("angel-court-hospitality"),
    oplocId: "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10",
    settings: {
      dashboardId: "angel-court-hospitality",
      version: 2,
      managementFee: { mode: "percentage", value: 8, label: "Angel Court management fee" },
      deliveryCharge: { enabled: true, amount: 35, label: "CPU delivery charge" },
      buildingCharges: {
        enabled: true,
        housekeeping: { hourly: 23.68, label: "Housekeeping" },
        security: { hourly: 29.95, minimumHours: 8, label: "Security" },
        aircon: { hourly: 200, afterHour: 19, label: "Aircon after 7pm" },
        venueHire: { enabled: false, amount: 1000, label: "Venue hire" },
      },
      labourRates: [
        { id: "chef", label: "Chef" },
        { id: "foh-assistant", label: "FOH Assistant" },
        { id: "kp", label: "KP" },
      ],
      vatRate: 0.2,
      updatedBy: identity.value.externalUid,
      googleQuoteFolderId: "18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO",
      googleMatrixFolderId: "1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X",
      googleMenuFolderId: "1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc",
      googleMenuTemplateId: "1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw",
    },
  },
];

if (new Set(targets.flatMap(({ settings }) => [settings.googleQuoteFolderId, settings.googleMatrixFolderId, settings.googleMenuFolderId])).size !== 6) {
  throw new Error("Refusing write: quote, allergen, and menu destinations must be six distinct approved folders.");
}
if (targets[0].settings.googleMenuTemplateId || targets[1].settings.googleMenuTemplateId !== "1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw") {
  throw new Error("Refusing write: Hospitality template values differ from the approved RCoA/Angel Court classification.");
}

const updatedAt = updatedAtArg || new Date().toISOString();
for (const target of targets) target.settings.updatedAt = updatedAt;
const auditId = `hospitality-drive-settings-${stableId(targets.map(({ id }) => id).join(":"))}`;
const receipt = {
  auditId,
  action: "Hospitality dashboard Drive settings created",
  entityReference: targets.map(({ dashboardId, id }) => `${settingsCollection}/${id} (${dashboardId})`).join("; "),
  actorId: identity.value.externalUid,
  actorName: identity.value.displayName,
  timestamp: updatedAt,
  reason: "Created only the explicitly approved production Drive routing fields for RCoA and One Angel Court; existing commercial defaults were preserved. RCoA menu template and Angel Court flat/tent templates remain deferred.",
  oplocId: null,
};

const baseline = await Promise.all([
  ...targets.map(({ id }) => readDocument(settingsCollection, id)),
  readDocument(auditCollection, auditId),
]);
if (baseline.some(({ exists }) => exists)) {
  throw new Error("Refusing write: a target settings document or audit receipt already exists; create-only baseline is not empty.");
}

const plan = {
  projectId,
  operator: { email: operatorEmail, authmodIdentityId: identityId, firebaseUid: "[redacted in status]" },
  mode: apply ? "APPLY" : "DRY RUN",
  settingsWrites: targets.map(({ id, settings }) => ({ path: `${settingsCollection}/${id}`, currentState: "ABSENT", body: settings })),
  auditReceipt: { path: `${auditCollection}/${auditId}`, currentState: "ABSENT", body: receipt },
  atomicCommit: true,
};
console.log(JSON.stringify(plan, null, 2));

if (!apply) {
  console.log("Dry run only. Pass --apply to create the two settings records and one audit receipt atomically.");
  process.exit(0);
}

const writes = [
  ...targets.map(({ id, settings }) => ({
    update: { name: documentName(settingsCollection, id), fields: encodeFields(settings) },
    currentDocument: { exists: false },
  })),
  {
    update: { name: documentName(auditCollection, auditId), fields: encodeFields(receipt) },
    currentDocument: { exists: false },
  },
];
await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:commit`, {
  method: "POST",
  body: JSON.stringify({ writes }),
});

const readbacks = await Promise.all([
  ...targets.map(({ id }) => readDocument(settingsCollection, id)),
  readDocument(auditCollection, auditId),
]);
const expected = [...targets.map(({ settings }) => settings), receipt];
if (readbacks.some(({ exists }, index) => !exists || !deepEqual(readbacks[index].value, expected[index]))) {
  throw new Error("Atomic create returned, but read-back did not exactly match the approved settings bodies and receipt.");
}
console.log(JSON.stringify({ result: "VERIFIED", settingsDocuments: 2, auditReceipts: 1, productionFirestoreWrites: 3, exactReadBack: true }, null, 2));
