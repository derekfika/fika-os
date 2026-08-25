import crypto from "node:crypto";
import * as XLSX from "xlsx";
import type { AuthPrincipal, ImportRecord, ImportRowResolution, ProposedAccessChange } from "./model";
import { idempotentId, normalizeEmail, now } from "./model";
import { appendAudit } from "./audit";
import { createAuthIdentity, linkLegend, setFullAccess, setIdentityStatus } from "./identity";
import { assignSite, grantStandardApplicationAccess } from "./grants";
import { grantAuthority, hasAuthmodAdmin } from "./authority";
import type { AuthModRepository } from "./repository";

const PARSER_VERSION = "authmod-import-v2";
const TRUE = new Set(["true", "yes", "y", "1", "x", "checked"]);
const FALSE = new Set(["false", "no", "n", "0", "", "unchecked"]);
function parseBoolean(value: string | undefined, column: string, row: number) {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  throw new Error("Invalid boolean in " + column + " on row " + row + ".");
}
function tryBoolean(value: string | undefined, column: string, row: number, errors: string[]) {
  try { return parseBoolean(value, column, row); } catch (error) { errors.push((error as Error).message); return undefined; }
}
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function rowsFromBuffer(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: false, bookVBA: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("AUTHMOD workbook has no worksheet.");
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])));
}
function changes(row: Record<string, string>, identityId: string | undefined, rowNumber: number, errors: string[]): ProposedAccessChange[] {
  const result: ProposedAccessChange[] = [];
  if (!identityId) result.push({ kind: "identity", target: row.Email || "unmatched", operation: "create" });
  if (row.Active !== undefined && row.Active !== "") tryBoolean(row.Active, "Active", rowNumber, errors);
  if (row["Full Access"] !== undefined && row["Full Access"] !== "") tryBoolean(row["Full Access"], "Full Access", rowNumber, errors);
  for (const [column, value] of Object.entries(row)) {
    if (!value) continue;
    if (column.startsWith("site:oploc:") && tryBoolean(value, column, rowNumber, errors)) result.push({ kind: "site", target: column.slice("site:oploc:".length), operation: "activate" });
    if (column.startsWith("app:") && tryBoolean(value, column, rowNumber, errors)) result.push({ kind: "app", target: column.slice("app:".length), operation: "activate" });
    if (["AUTHMOD Admin", "Menu Publish", "Production Allergen Sign", "Final Allergen Sign"].includes(column) && tryBoolean(value, column, rowNumber, errors)) result.push({ kind: "authority", target: column, operation: "activate" });
  }
  return result;
}
function genericIdentityReason(value: string) { return value === "Identity requires explicit administrator resolution."; }

export async function previewAccessImport(repository: AuthModRepository, input: { buffer: Buffer; filename: string; actor: AuthPrincipal }) {
  if (input.actor.type !== "human" || !(await hasAuthmodAdmin(repository, input.actor.id))) throw Object.assign(new Error("AUTHMOD Admin authority is required to preview an access import."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  const raw = rowsFromBuffer(input.buffer); const fileHash = hash(input.buffer.toString("base64")); const importId = idempotentId("authmod-import", fileHash);
  const prior = await repository.getImport(importId);
  if (prior?.status === "previewed" || prior?.status === "partial" || prior?.status === "committed") return { record: prior, summary: prior.summary || { matched: 0, possibleMatches: 0, unmatched: 0, newUsers: 0, permissionChanges: 0, deactivations: 0, unresolved: 0 }, resolutions: await repository.listImportResolutions(importId) };
  const record: ImportRecord = { id: importId, sourceKind: "spreadsheet", originalFilename: input.filename, fileHash, parserVersion: PARSER_VERSION, status: "previewed", rowCount: raw.length, previewId: "preview:" + crypto.randomUUID(), uploadedBy: input.actor.id, uploadedAt: now(), version: 1 };
  let matched = 0, possibleMatches = 0, unmatched = 0, newUsers = 0, permissionChanges = 0, deactivations = 0, unresolved = 0;
  const activeOplocs = await repository.listActiveOplocs(); const applications = await repository.listApplications(); const knownApps = new Set(applications.map(value => value.appId));
  for (const [index, row] of raw.entries()) {
    const rowNumber = index + 2; const email = normalizeEmail(row.Email); const externalProvider = row["External Provider"]?.trim(); const externalUid = row["External UID"]?.trim(); const canonicalLegendId = row["Legend ID"]?.trim();
    const byExternal = externalProvider && externalUid ? await repository.findIdentityByExternal(externalProvider, externalUid) : undefined;
    const byEmail = email ? await repository.findIdentityByEmail(email) : undefined;
    const byLegend = canonicalLegendId ? await repository.findIdentityByLegend(canonicalLegendId) : undefined;
    const exact = byExternal || byEmail || byLegend;
    const candidates = exact ? [exact.id] : (email ? (await repository.listIdentities()).filter(identity => identity.normalizedEmail?.split("@")[0] === email.split("@")[0]).map(identity => identity.id) : []);
    const confidence = exact ? "exact" as const : candidates.length ? "possible" as const : "unmatched" as const;
    if (confidence === "exact") matched++; else if (confidence === "possible") { possibleMatches++; unresolved++; } else { unmatched++; newUsers++; unresolved++; }
    const errors: string[] = []; const proposed = changes(row, exact?.id, rowNumber, errors); permissionChanges += proposed.length;
    for (const column of Object.keys(row).filter(value => value.startsWith("site:oploc:"))) {
      const enabled = tryBoolean(row[column], column, rowNumber, errors);
      if (enabled && !activeOplocs.some(value => value.id === column.slice("site:oploc:".length))) errors.push("Unknown or inactive OPLOC column: " + column);
    }
    for (const column of Object.keys(row).filter(value => value.startsWith("app:"))) {
      const enabled = tryBoolean(row[column], column, rowNumber, errors);
      if (enabled && !knownApps.has(column.slice("app:".length))) errors.push("Unknown application column: " + column);
    }
    const unresolvedReasons = [...(confidence === "exact" ? [] : ["Identity requires explicit administrator resolution."]), ...errors];
    if (errors.length) unresolved++;
    const resolution: ImportRowResolution = { id: idempotentId(importId, "row", String(rowNumber)), importId, rowNumber, rowHash: hash(JSON.stringify(row)), input: row, candidateIdentityIds: candidates, matchReason: byExternal ? "external provider UID" : byEmail ? "exact normalized Workspace email" : byLegend ? "explicit canonical Legend ID" : candidates.length ? "possible email-local-part match" : undefined, confidence, selectedIdentityId: exact?.id, proposedChanges: proposed, unresolvedReasons, version: 1 };
    await repository.saveImportResolution(resolution);
    if (row.Active !== undefined && row.Active !== "" && !errors.length && tryBoolean(row.Active, "Active", rowNumber, []) === false) deactivations++;
  }
  record.summary = { matched, possibleMatches, unmatched, newUsers, permissionChanges, deactivations, unresolved };
  await repository.saveImport(record); await appendAudit(repository, { actor: input.actor, targetType: "ImportRecord", targetId: importId, action: "access-import-previewed", afterState: record.summary, provenance: "import", outcome: "committed" });
  return { record, summary: record.summary, resolutions: await repository.listImportResolutions(importId) };
}

export type ImportDecision = { identityId?: string; accept: boolean; createIdentity?: { displayName: string; email?: string; externalProvider?: string; externalUid?: string } };

export async function commitAccessImport(repository: AuthModRepository, input: { importId: string; actor: AuthPrincipal; decisions: Record<string, ImportDecision>; idempotencyKey: string }) {
  if (!(await hasAuthmodAdmin(repository, input.actor.id))) throw Object.assign(new Error("AUTHMOD Admin authority is required to commit an access import."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  const prior = await repository.getImport(input.importId);
  if (!prior) throw Object.assign(new Error("Import preview not found."), { status: 404 });
  if (prior.status === "committed") {
    if (prior.commitIdempotencyKey === input.idempotencyKey) return { committedRows: prior.summary?.matched || 0, importId: input.importId };
    throw Object.assign(new Error("This import has already been committed with a different idempotency key."), { status: 409, code: "AUTHMOD_IMPORT_ALREADY_COMMITTED" });
  }
  const resolutions = await repository.listImportResolutions(input.importId); let committed = 0; let blocked = 0; let unresolved = 0;
  const applications = await repository.listApplications(); const activeOplocs = await repository.listActiveOplocs();
  for (const resolution of resolutions) {
    if (resolution.appliedAt) { committed++; continue; }
    const decision = input.decisions[resolution.id];
    if (!decision) { if (resolution.decision !== "exclude") unresolved++; continue; }
    if (!decision.accept) {
      await repository.saveImportResolution({ ...resolution, decision: "exclude", decidedBy: input.actor.id, decidedAt: now(), version: resolution.version + 1 }, resolution.version);
      continue;
    }
    const nonIdentityErrors = resolution.unresolvedReasons.filter(reason => !genericIdentityReason(reason));
    if (nonIdentityErrors.length) { blocked++; continue; }
    let identity = decision.identityId ? await repository.getIdentity(decision.identityId) : undefined;
    if (!identity && decision.createIdentity) identity = await createAuthIdentity(repository, { actor: input.actor, displayName: decision.createIdentity.displayName, email: decision.createIdentity.email || resolution.input.Email, externalProvider: decision.createIdentity.externalProvider, externalUid: decision.createIdentity.externalUid, status: "active", provenance: "import" });
    if (!identity) { blocked++; continue; }
    const canonicalLegendId = resolution.input["Legend ID"]?.trim();
    if (canonicalLegendId) await linkLegend(repository, { identityId: identity.id, legendId: canonicalLegendId, actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet canonical Legend reconciliation." });
    if (resolution.input.Active !== undefined && resolution.input.Active !== "") await setIdentityStatus(repository, { identityId: identity.id, status: parseBoolean(resolution.input.Active, "Active", resolution.rowNumber) ? "active" : "inactive", actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet import." });
    const siteIds = Object.keys(resolution.input).filter(value => value.startsWith("site:oploc:") && parseBoolean(resolution.input[value], value, resolution.rowNumber)).map(value => value.slice("site:oploc:".length)).filter(id => activeOplocs.some(value => value.id === id));
    for (const siteId of siteIds) await assignSite(repository, { identityId: identity.id, oplocId: siteId, actor: input.actor, source: "import", reason: "Reviewed AUTHMOD spreadsheet site assignment." });
    if (resolution.input["Full Access"] !== undefined && resolution.input["Full Access"] !== "") await setFullAccess(repository, { identityId: identity.id, fullAccess: parseBoolean(resolution.input["Full Access"], "Full Access", resolution.rowNumber), actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet Full Access change." });
    for (const app of applications.filter(value => parseBoolean(resolution.input["app:" + value.appId], "app:" + value.appId, resolution.rowNumber))) await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor: input.actor, idempotencyKey: input.idempotencyKey });
    const special: Array<[string, string, "Approve" | "Publish" | "Administer", string]> = [["Menu Publish", "menu.publish", "Publish", "menu-planning"], ["Production Allergen Sign", "production.allergen-sign", "Approve", "cpu-production"], ["Final Allergen Sign", "production.allergen-final-approve", "Approve", "cpu-production"], ["AUTHMOD Admin", "authmod", "Administer", "integration-hub"]];
    for (const [column, resource, action, appId] of special) if (parseBoolean(resolution.input[column], column, resolution.rowNumber)) await grantAuthority(repository, { subjectId: identity.id, subjectType: "human", actor: input.actor, appId, resource, action, scope: siteIds.length ? { kind: "oploc", ids: siteIds } : { kind: "organisation", ids: [] }, provenance: "import", reason: "Reviewed AUTHMOD spreadsheet special authority." });
    const appIds = applications.filter(value => parseBoolean(resolution.input["app:" + value.appId], "app:" + value.appId, resolution.rowNumber)).map(value => value.appId);
    const authorityIds: string[] = [];
    const applied = { ...resolution, decision: "accept" as const, selectedIdentityId: identity.id, decidedBy: input.actor.id, decidedAt: resolution.decidedAt || now(), unresolvedReasons: nonIdentityErrors, appliedAt: now(), appliedBy: input.actor.id, appliedCommitIdempotencyKey: input.idempotencyKey, appliedResult: { identityId: identity.id, appIds, oplocIds: siteIds, authorityIds }, version: resolution.version + 1 };
    await repository.saveImportResolution(applied, resolution.version);
    committed++;
  }
  const status = blocked || unresolved ? "partial" as const : "committed" as const;
  const record: ImportRecord = { ...prior, status, committedAt: status === "committed" ? now() : prior.committedAt, committedBy: input.actor.id, commitIdempotencyKey: status === "committed" ? input.idempotencyKey : prior.commitIdempotencyKey, version: prior.version + 1, summary: { ...(prior.summary || { matched: 0, possibleMatches: 0, unmatched: 0, newUsers: 0, permissionChanges: 0, deactivations: 0, unresolved: 0 }), matched: committed, unresolved: blocked + unresolved } };
  await repository.saveImport(record, prior.version); await appendAudit(repository, { actor: input.actor, targetType: "ImportRecord", targetId: input.importId, action: "access-import-" + status, afterState: { committedRows: committed, blockedRows: blocked }, provenance: "import", outcome: status === "committed" ? "committed" : "rejected", idempotencyKey: input.idempotencyKey });
  return { committedRows: committed, blockedRows: blocked, importId: input.importId, status };
}
