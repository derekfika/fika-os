#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";

const EXPECTED_BUCKET = "fika-os-dev-kafoodle-catalogue-europe-west4";
const EXPECTED_PREFIX = "kafoodle/compositions/v2/2026-11-03/";
const ARCHIVE_ROOT = "fika_kafoodle_recipe_import_2026-11-03/";
const EXPECTED_PACKAGE_SHA256 = "2b043a74d97fad58c38c47deabfde1e24274de3449defc83af67a7d32b48ba7d";
const EXPECTED_SOURCE_CSV_SHA256 = "ee4406b3ae81534e111550cf4dc314a568f902f3ef9fe124907bc480cd5faf31";
const EXPECTED_GZIP_SHA256 = "f829b60e8d75a7d417a6aea092a198d0064ad0a50363988465187cccf09c8b29";
const EXPECTED_JSON_SHA256 = "735732e081f1ef6124d96b75adabd23db9d2c97ca7b6f12fec6bc3f8643fd388";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(message); };

function args(argv) {
  const out = { execute: false, stagingAuthorized: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") out.execute = true;
    else if (arg === "--staging-authorized") out.stagingAuthorized = true;
    else if (["--archive", "--source-csv", "--bucket", "--prefix", "--pr", "--reason"].includes(arg)) {
      const value = argv[++i]; if (!value || value.startsWith("--")) fail(`Missing value after ${arg}.`);
      out[arg.slice(2).replaceAll("-", "")] = value;
    } else fail(`Unknown option: ${arg}`);
  }
  return out;
}

async function validate(options) {
  if (!options.archive) fail("Pass --archive <path-to-import-zip>.");
  const archiveBytes = await readFile(options.archive);
  if (sha(archiveBytes) !== EXPECTED_PACKAGE_SHA256) fail("The supplied import ZIP does not match the verified archive checksum.");
  const archive = await JSZip.loadAsync(archiveBytes);
  const read = async name => {
    const file = archive.file(ARCHIVE_ROOT + name);
    if (!file) fail(`The import archive is missing ${name}.`);
    return file.async("nodebuffer");
  };
  const [gzip, packageManifestBytes, reportBytes] = await Promise.all([read("recipe-compositions.json.gz"), read("import-manifest.json"), read("validation-report.json")]);
  const sourceManifest = JSON.parse(packageManifestBytes.toString("utf8"));
  const validationReport = JSON.parse(reportBytes.toString("utf8"));
  if (sourceManifest.schemaVersion !== 2 || sourceManifest.dataset !== "kafoodle-recipe-compositions" || sourceManifest.exportDate !== "2026-11-03" || sourceManifest.object !== "recipe-compositions.json.gz" || sourceManifest.sourceCsvSha256 !== EXPECTED_SOURCE_CSV_SHA256) fail("The package manifest is not the expected v2 Kafoodle composition snapshot.");
  const json = gunzipSync(gzip, { maxOutputLength: 16 * 1024 * 1024 });
  const payload = JSON.parse(json.toString("utf8"));
  if (gzip.length !== sourceManifest.gzipBytes || sha(gzip) !== sourceManifest.gzipSha256 || sha(gzip) !== EXPECTED_GZIP_SHA256 || json.length !== sourceManifest.jsonBytes || sha(json) !== sourceManifest.jsonSha256 || sha(json) !== EXPECTED_JSON_SHA256) fail("The gzip or decompressed JSON does not match the verified package hashes or sizes.");
  const groups = payload.recipes;
  if (payload.schemaVersion !== 2 || payload.dataset !== sourceManifest.dataset || payload.exportDate !== sourceManifest.exportDate || payload.sourceCsvSha256 !== sourceManifest.sourceCsvSha256 || !Array.isArray(groups)) fail("The composition payload identity does not match the manifest.");
  const requiredColumns = ["Recipe Name", "Reference", "List", "Ingredient - name", "Ingredient - Ingredient/Recipe id", "Ingredient - quantity", "Ingredient - UoM [g, ml, etc]"];
  if (!Array.isArray(payload.sourceColumns) || payload.sourceColumns.length !== sourceManifest.columns || !payload.sourceColumns.every(column => typeof column === "string") || requiredColumns.some(column => !payload.sourceColumns.includes(column))) fail("The source columns are missing, malformed or incompatible with the v2 schema.");
  if (typeof payload.sourceFile !== "string" || !Number.isSafeInteger(payload.sourceRows) || payload.sourceRows < 0) fail("The composition payload is missing its source identity or valid row count.");
  let nextSourceRow = 2;
  const lineCount = groups.reduce((sum, group, index) => {
    if (group.sourceGroupIndex !== index || !Number.isSafeInteger(group.sourceRowStart) || !Number.isSafeInteger(group.sourceRowEnd) || group.sourceRowStart !== nextSourceRow || !["recipeName", "reference", "list"].every(key => typeof group[key] === "string") || !group.metadata || typeof group.metadata !== "object" || Array.isArray(group.metadata) || !Object.values(group.metadata).every(value => typeof value === "string") || !Array.isArray(group.lines) || !group.lines.length || group.sourceRowEnd - group.sourceRowStart + 1 !== group.lines.length) fail(`Composition group ${index + 1} has malformed source boundaries or fields.`);
    for (let offset = 0; offset < group.lines.length; offset++) {
      const line = group.lines[offset];
      if (!Number.isSafeInteger(line.sourceRow) || line.sourceRow !== group.sourceRowStart + offset || !["ingredientName", "ingredientId", "supplierCode", "supplierName", "quantityRaw", "unitRaw"].every(key => typeof line[key] === "string")) fail(`Composition group ${index + 1} has malformed ingredient lines or source order.`);
    }
    nextSourceRow = group.sourceRowEnd + 1;
    return sum + group.lines.length;
  }, 0);
  const names = new Set(groups.map(group => group.recipeName));
  if (lineCount !== sourceManifest.sourceRows || lineCount !== payload.sourceRows || nextSourceRow !== sourceManifest.sourceRows + 2 || groups.length !== sourceManifest.recipeGroups || names.size !== sourceManifest.distinctRecipeNames) fail("Recipe or ingredient line totals do not match the manifest.");
  if (!validationReport || !Number.isSafeInteger(validationReport.groupsWithNoPreparationSteps) || !validationReport.nonMassVolumeUnits || typeof validationReport.nonMassVolumeUnits !== "object") fail("The validation report is missing expected review flags.");
  if (payload.labelSafetyStatus !== "NOT_APPROVED_FOR_FOOD_LABELS" || sourceManifest.labelSafetyStatus !== payload.labelSafetyStatus) fail("The mandatory food-label hold is missing.");
  if (options.sourcecsv) {
    const sourceCsv = await readFile(options.sourcecsv);
    if (sha(sourceCsv) !== sourceManifest.sourceCsvSha256) fail("The supplied source CSV does not match the recorded source checksum.");
  }
  const manifest = {
    schemaVersion: 2,
    dataset: sourceManifest.dataset,
    exportDate: sourceManifest.exportDate,
    file: {
      object: "recipe-compositions.json.gz",
      sourceCsvSha256: sourceManifest.sourceCsvSha256,
      sourceCsvFilename: sourceManifest.sourceCsvFilename,
      columns: sourceManifest.columns,
      sourceRows: sourceManifest.sourceRows,
      recipeGroups: sourceManifest.recipeGroups,
      distinctRecipeNames: sourceManifest.distinctRecipeNames,
      jsonBytes: sourceManifest.jsonBytes,
      gzipBytes: sourceManifest.gzipBytes,
      jsonSha256: sourceManifest.jsonSha256,
      gzipSha256: sourceManifest.gzipSha256,
      status: "unreviewed",
      labelSafetyStatus: "NOT_APPROVED_FOR_FOOD_LABELS",
    },
  };
  if (options.bucket && options.bucket !== EXPECTED_BUCKET) fail(`This task only permits the configured staging bucket ${EXPECTED_BUCKET}.`);
  if (options.prefix && options.prefix !== EXPECTED_PREFIX) fail(`This task only permits the new immutable prefix ${EXPECTED_PREFIX}.`);
  return { gzip, manifestBytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), sourceManifest, validationReport, lineCount, groups: groups.length, distinctNames: names.size, sourceCsvVerified: Boolean(options.sourcecsv) };
}

function gitOutput(...command) { return execFileSync("git", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function ghJson(...command) { return JSON.parse(execFileSync("gh", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); }

function verifyGovernance(options) {
  if (!options.execute) return;
  if (!options.stagingAuthorized || !options.reason || options.reason.length < 12 || !options.pr) fail("Staging execution requires --execute, explicit --staging-authorized, --pr <number>, and a scoped owner reason of at least 12 characters.");
  if (gitOutput("status", "--porcelain")) fail("Staging execution requires a clean task workspace.");
  const head = gitOutput("rev-parse", "HEAD");
  const pr = ghJson("pr", "view", options.pr, "--json", "number,state,baseRefName,headRefOid,url");
  if (pr.baseRefName !== "main" || pr.headRefOid !== head || !["OPEN", "MERGED"].includes(pr.state)) fail("The PR must target main and its exact head must match this workspace.");
  const checks = ghJson("pr", "checks", String(options.pr), "--json", "name,state");
  if (!checks.some(check => check.name === "Workflow / merge-gate" && check.state === "SUCCESS")) fail("The exact-source Workflow / merge-gate check must pass before staging ingestion.");
  return { head, pr: pr.url };
}

async function upload(bucket, name, bytes, contentType, token) {
  const encodedName = encodeURIComponent(name);
  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodedName}`;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body: bytes });
  if (response.status === 412 || response.status === 409) fail(`Refusing to replace existing GCS object ${name}. Select a new immutable prefix.`);
  if (!response.ok) fail(`GCS refused object creation (${response.status}) for ${name}; no overwrite or retry was attempted.`);
  return await response.json();
}

async function assertNewObjects(bucket, names, token) {
  for (const name of names) {
    const endpoint = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) continue;
    if (response.ok) fail(`Refusing to use non-empty import prefix: GCS object ${name} already exists.`);
    fail(`Could not prove that GCS object ${name} is absent (${response.status}); no objects were created.`);
  }
}

async function main() {
  const options = args(process.argv.slice(2));
  const checked = await validate(options);
  const report = {
    mode: options.execute ? "staging-execution" : "dry-run",
    bucket: EXPECTED_BUCKET,
    prefix: EXPECTED_PREFIX,
    objects: [
      { name: "recipe-compositions.json.gz", bytes: checked.sourceManifest.gzipBytes, sha256: checked.sourceManifest.gzipSha256 },
      { name: "manifest.json", bytes: checked.manifestBytes.length, sha256: sha(checked.manifestBytes) },
    ],
    package: { exportDate: checked.sourceManifest.exportDate, sourceRows: checked.lineCount, recipeGroups: checked.groups, distinctRecipeNames: checked.distinctNames, sourceCsvChecksumVerified: checked.sourceCsvVerified, embeddedValidationReport: checked.validationReport },
    labelSafetyStatus: "NOT_APPROVED_FOR_FOOD_LABELS",
    overwrite: false,
    readyToUpload: true,
    uploaded: false,
  };
  if (options.execute) {
    const provenance = verifyGovernance(options);
    const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!token) fail("gcloud did not return an authenticated access token; no objects were created.");
    await assertNewObjects(EXPECTED_BUCKET, [EXPECTED_PREFIX + "recipe-compositions.json.gz", EXPECTED_PREFIX + "manifest.json"], token);
    // The manifest is written last, so Hub cannot discover a half-written snapshot.
    const payload = await upload(EXPECTED_BUCKET, EXPECTED_PREFIX + "recipe-compositions.json.gz", checked.gzip, "application/gzip", token);
    const manifest = await upload(EXPECTED_BUCKET, EXPECTED_PREFIX + "manifest.json", checked.manifestBytes, "application/json", token);
    report.uploaded = true;
    report.objectGenerations = { payload: payload.generation, manifest: manifest.generation };
    report.provenance = provenance;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch(error => { process.stderr.write(`Food Data import stopped: ${error.message}\n`); process.exitCode = 1; });
