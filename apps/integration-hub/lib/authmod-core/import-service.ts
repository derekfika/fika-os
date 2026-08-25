import crypto from "node:crypto";
import * as XLSX from "xlsx";
import type { AuthPrincipal, ImportRecord, ImportRowResolution, ProposedAccessChange } from "./model";
import { idempotentId, normalizeEmail, now } from "./model";
import { appendAudit } from "./audit";
import { createAuthIdentity, linkLegend, setIdentityStatus } from "./identity";
import { assignSite, grantStandardApplicationAccess } from "./grants";
import { hasAuthmodAdmin } from "./authority";
import { grantAuthority } from "./authority";
import { setFullAccess } from "./identity";
import type { AuthModRepository } from "./repository";

const PARSER_VERSION = "authmod-import-v1";
const TRUE = new Set(["true", "yes", "y", "1", "x", "checked"]);
const FALSE = new Set(["false", "no", "n", "0", "", "unchecked"]);
function bool(value: string | undefined, column: string, row: number) {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRUE.has(normalized)) return true; if (FALSE.has(normalized)) return false;
  throw new Error("Invalid boolean in " + column + " on row " + row + ".");
}
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function rowsFromBuffer(buffer: Buffer, filename: string): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: false, bookVBA: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]]; if (!sheet) throw new Error("AUTHMOD workbook has no worksheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])));
}
function changes(row: Record<string, string>, identityId: string | undefined): ProposedAccessChange[] {
  const result: ProposedAccessChange[] = []; if (!identityId) result.push({ kind: "identity", target: row.Email || "unmatched", operation: "create" });
  if (row.Active !== undefined) result.push({ kind: "identity", target: identityId || row.Email, operation: "update", detail: "status" });
  for (const [column, value] of Object.entries(row)) {
    if (!value) continue;
    if (column.startsWith("site:oploc:")) result.push({ kind: "site", target: column.slice("site:oploc:".length), operation: "activate" });
    if (column.startsWith("app:")) result.push({ kind: "app", target: column.slice("app:".length), operation: "activate" });
    if (["AUTHMOD Admin", "Menu Publish", "Production Allergen Sign", "Final Allergen Sign"].includes(column)) result.push({ kind: "authority", target: column, operation: "activate" });
  }
  return result;
}
export async function previewAccessImport(repository: AuthModRepository, input: { buffer: Buffer; filename: string; actor: AuthPrincipal }) {
  const raw = rowsFromBuffer(input.buffer, input.filename); const fileHash = hash(input.buffer.toString("base64")); const importId = idempotentId("authmod-import", fileHash);
  const prior = await repository.getImport(importId);
  if (prior?.status === "previewed" || prior?.status === "committed") return { record: prior, summary: prior.summary || { matched: 0, possibleMatches: 0, unmatched: 0, newUsers: 0, permissionChanges: 0, deactivations: 0, unresolved: 0 }, resolutions: await repository.listImportResolutions(importId) };
  const record: ImportRecord = { id: importId, sourceKind: "spreadsheet", originalFilename: input.filename, fileHash, parserVersion: PARSER_VERSION, status: "previewed", rowCount: raw.length, previewId: "preview:" + crypto.randomUUID(), uploadedBy: input.actor.id, uploadedAt: now(), version: 1 };
  let matched = 0, possibleMatches = 0, unmatched = 0, newUsers = 0, permissionChanges = 0, deactivations = 0, unresolved = 0;
  for (const [index, row] of raw.entries()) {
    const email = normalizeEmail(row.Email); const exact = email ? await repository.findIdentityByEmail(email) : undefined;
    const candidates = exact ? [exact.id] : (email ? (await repository.listIdentities()).filter(identity => identity.normalizedEmail?.split("@")[0] === email.split("@")[0]).map(identity => identity.id) : []);
    const confidence = exact ? "exact" as const : candidates.length ? "possible" as const : "unmatched" as const;
    if (confidence === "exact") matched++; else if (confidence === "possible") { possibleMatches++; unresolved++; } else { unmatched++; newUsers++; unresolved++; }
    if (row.Active !== undefined && row.Active !== "" && !bool(row.Active, "Active", index + 2)) deactivations++;
    const proposed = changes(row, exact?.id); permissionChanges += proposed.length;
    const activeOplocs = await repository.listActiveOplocs(); const unresolvedReasons = confidence === "exact" ? [] : ["Identity requires explicit administrator resolution."];
    for (const column of Object.keys(row).filter(value => value.startsWith("site:oploc:") && row[value])) if (!activeOplocs.some(value => value.id === column.slice("site:oploc:".length))) unresolvedReasons.push("Unknown or inactive OPLOC column: " + column);
    const knownApps = new Set((await repository.listApplications()).map(value => value.appId)); for (const column of Object.keys(row).filter(value => value.startsWith("app:") && row[value])) if (!knownApps.has(column.slice("app:".length))) unresolvedReasons.push("Unknown application column: " + column);
    if (unresolvedReasons.length && confidence === "exact") unresolved++;
    const resolution: ImportRowResolution = { id: idempotentId(importId, "row", String(index + 2)), importId, rowNumber: index + 2, rowHash: hash(JSON.stringify(row)), input: row, candidateIdentityIds: candidates, matchReason: exact ? "exact normalized email" : candidates.length ? "possible email-local-part match" : undefined, confidence, selectedIdentityId: exact?.id, proposedChanges: proposed, unresolvedReasons, version: 1 };
    await repository.saveImportResolution(resolution);
  }
  record.summary = { matched, possibleMatches, unmatched, newUsers, permissionChanges, deactivations, unresolved };
  await repository.saveImport(record);
  await appendAudit(repository, { actor: input.actor, targetType: "ImportRecord", targetId: importId, action: "access-import-previewed", afterState: record.summary, provenance: "import", outcome: "committed" });
  return { record, summary: record.summary, resolutions: await repository.listImportResolutions(importId) };
}
export async function commitAccessImport(repository: AuthModRepository, input: { importId: string; actor: AuthPrincipal; decisions: Record<string, { identityId?: string; accept: boolean }>; idempotencyKey: string }) {
  if (!(await hasAuthmodAdmin(repository, input.actor.id))) throw Object.assign(new Error("AUTHMOD Admin authority is required to commit an access import."), { status: 403, code: "AUTHMOD_ADMIN_REQUIRED" });
  const resolutions = await repository.listImportResolutions(input.importId); if (!resolutions.length) throw Object.assign(new Error("Import preview not found."), { status: 404 });
  const prior = await repository.getImport(input.importId);
  if (prior?.status === "committed" && prior.commitIdempotencyKey === input.idempotencyKey) return { committedRows: prior.summary?.matched || 0, importId: input.importId };
  const record: ImportRecord = { ...(prior || { id: input.importId, sourceKind: "spreadsheet" as const, fileHash: "", parserVersion: PARSER_VERSION, rowCount: resolutions.length, uploadedBy: "unknown", uploadedAt: now(), version: 1 }), status: "committed", rowCount: resolutions.length, committedAt: now(), committedBy: input.actor.id, commitIdempotencyKey: input.idempotencyKey };
  let committed = 0;
  for (const resolution of resolutions) {
    const decision = input.decisions[resolution.id]; if (!decision?.accept || !decision.identityId) continue;
    if (resolution.unresolvedReasons.length) continue;
    if (resolution.confidence !== "exact" && !decision.identityId) continue;
    const identity = await repository.getIdentity(decision.identityId); if (!identity) continue;
    if (resolution.input.Legend && resolution.input.Legend !== "") await linkLegend(repository, { identityId: identity.id, legendId: resolution.input["Legend ID"] || resolution.input.Legend, actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet identity reconciliation." });
    if (resolution.input.Active !== undefined && resolution.input.Active !== "") await setIdentityStatus(repository, { identityId: identity.id, status: bool(resolution.input.Active, "Active", resolution.rowNumber) ? "active" : "inactive", actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet import." });
    const siteIds = Object.keys(resolution.input).filter(value => value.startsWith("site:oploc:") && resolution.input[value] && bool(resolution.input[value], value, resolution.rowNumber)).map(value => value.slice("site:oploc:".length));
    for (const siteId of siteIds) if ((await repository.listActiveOplocs()).some(value => value.id === siteId)) await assignSite(repository, { identityId: identity.id, oplocId: siteId, actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet site assignment." });
    if (resolution.input["Full Access"] !== undefined && resolution.input["Full Access"] !== "") await setFullAccess(repository, { identityId: identity.id, fullAccess: bool(resolution.input["Full Access"], "Full Access", resolution.rowNumber), actor: input.actor, reason: "Reviewed AUTHMOD spreadsheet Full Access change." });
    for (const app of (await repository.listApplications()).filter(value => resolution.input["app:" + value.appId] && bool(resolution.input["app:" + value.appId], "app:" + value.appId, resolution.rowNumber))) await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor: input.actor, scopeIds: siteIds, idempotencyKey: input.idempotencyKey });
    const special: Array<[string, string, "Approve" | "Publish" | "Administer"]> = [["Menu Publish", "menu.publish", "Publish"], ["Production Allergen Sign", "production.allergen-sign", "Approve"], ["Final Allergen Sign", "production.allergen-final-approve", "Approve"], ["AUTHMOD Admin", "authmod", "Administer"]];
    for (const [column, resource, action] of special) if (resolution.input[column] && bool(resolution.input[column], column, resolution.rowNumber)) await grantAuthority(repository, { subjectId: identity.id, subjectType: "human", actor: input.actor, appId: column === "Menu Publish" ? "menu-planning" : column === "AUTHMOD Admin" ? "integration-hub" : "cpu-production", resource, action, scope: siteIds.length ? { kind: "oploc", ids: siteIds } : { kind: "organisation", ids: [] }, provenance: "import", reason: "Reviewed AUTHMOD spreadsheet special authority." });
    committed++;
  }
  record.summary = { ...(prior?.summary || { matched: 0, possibleMatches: 0, unmatched: 0, newUsers: 0, permissionChanges: 0, deactivations: 0, unresolved: 0 }), matched: committed };
  await repository.saveImport(record, prior?.version); await appendAudit(repository, { actor: input.actor, targetType: "ImportRecord", targetId: input.importId, action: "access-import-committed", afterState: { committedRows: committed }, provenance: "import", outcome: "committed", idempotencyKey: input.idempotencyKey });
  return { committedRows: committed, importId: input.importId };
}
