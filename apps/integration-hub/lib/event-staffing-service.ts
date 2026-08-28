import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { isTerminatedLegend } from "./connection-rules";
import { sha256 } from "./profiler";
import { parseCanonical, type CanonicalEntityType } from "./schemas";
import type { CanonicalRecord } from "./types";
import { listCanonicalRecordsByTypes } from "./canonical-oplocs";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");
const tiers = { primary: 0, secondary: 1, fallback: 2 } as const;
type Lifecycle = "active" | "archived";

export type EventStaffingCommand =
  | { action: "save-operational-team"; canonicalId?: string; expectedVersion?: number; teamName: string; description?: string; lifecycleState: Lifecycle }
  | { action: "save-team-membership"; canonicalId?: string; expectedVersion?: number; legendId: string; teamId: string; effectiveFrom: string; effectiveTo?: string; notes?: string; lifecycleState: Lifecycle }
  | { action: "save-event-role"; canonicalId?: string; expectedVersion?: number; roleName: string; description?: string; lifecycleState: "active" | "retired" }
  | { action: "save-event-staffing-preference"; canonicalId?: string; expectedVersion?: number; legendId: string; eventRoleId: string; eligibility: keyof typeof tiers; suggestionRank: number; effectiveFrom: string; effectiveTo?: string; notes?: string; lifecycleState: Lifecycle };

export type EventSuggestion = { legendId: string; label: string; eventRoleId: string; eventRoleLabel: string; eligibility: keyof typeof tiers; suggestionRank: number; teams: string[]; reason: string };

export async function eventStaffingOverview() {
  const records = await listCanonicalRecordsByTypes(["Employment", "Legend", "Operational Team", "Event Role", "Team Membership", "Event Staffing Preference"]);
  return eventStaffingOverviewFromRecords(records as CanonicalRecord[]);
}

export function eventStaffingOverviewFromRecords(records: CanonicalRecord[]) {
  const today = new Date().toISOString().slice(0, 10);
  const employments = records.filter(record => record.entityType === "Employment" && record.lifecycleStatus !== "archived");
  const legends = records.filter(record => record.entityType === "Legend" && record.lifecycleStatus !== "archived").map(record => ({ canonicalId: record.canonicalId, label: String(record.record.preferredName || record.record.displayName || record.canonicalId), terminated: isTerminatedLegend(record, employments) })).sort(byLabel);
  const legendLabels = new Map(legends.map(item => [item.canonicalId, item.label]));
  const teams = named(records, "Operational Team", "teamName");
  const roles = named(records, "Event Role", "roleName");
  const teamLabels = new Map(teams.map(item => [item.canonicalId, item.label]));
  const roleLabels = new Map(roles.map(item => [item.canonicalId, item.label]));
  const memberships = records.filter(record => record.entityType === "Team Membership" && record.lifecycleStatus !== "archived").map(record => ({ canonicalId: record.canonicalId, legendId: String(record.record.legendId || ""), legendLabel: legendLabels.get(String(record.record.legendId || "")) || "Unavailable Legend", teamId: String(record.record.teamId || ""), teamLabel: teamLabels.get(String(record.record.teamId || "")) || "Archived team", effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: text(record.record.effectiveTo), lifecycleState: String(record.record.lifecycleState || "active") as Lifecycle, notes: text(record.record.notes), version: Number(record.record.version || 0), activeNow: activeOn(record.record, today) && record.record.lifecycleState === "active" })).sort((a,b) => a.legendLabel.localeCompare(b.legendLabel) || a.teamLabel.localeCompare(b.teamLabel));
  const preferences = records.filter(record => record.entityType === "Event Staffing Preference" && record.lifecycleStatus !== "archived").map(record => ({ canonicalId: record.canonicalId, legendId: String(record.record.legendId || ""), legendLabel: legendLabels.get(String(record.record.legendId || "")) || "Unavailable Legend", eventRoleId: String(record.record.eventRoleId || ""), eventRoleLabel: roleLabels.get(String(record.record.eventRoleId || "")) || "Archived event role", eligibility: String(record.record.eligibility || "fallback") as keyof typeof tiers, suggestionRank: Number(record.record.suggestionRank || 0), effectiveFrom: String(record.record.effectiveFrom || ""), effectiveTo: text(record.record.effectiveTo), lifecycleState: String(record.record.lifecycleState || "active") as Lifecycle, notes: text(record.record.notes), version: Number(record.record.version || 0), activeNow: activeOn(record.record, today) && record.record.lifecycleState === "active" })).sort((a,b) => a.legendLabel.localeCompare(b.legendLabel) || tiers[a.eligibility] - tiers[b.eligibility] || a.suggestionRank - b.suggestionRank);
  return { today, legends, teams, eventRoles: roles, memberships, preferences };
}

export async function eventStaffingSuggestions(eventRoleName: string) {
  const records = await listCanonicalRecordsByTypes(["Employment", "Legend", "Operational Team", "Event Role", "Team Membership", "Event Staffing Preference"]);
  return suggestionsFromRecords(records as CanonicalRecord[], eventRoleName);
}

export function suggestionsFromRecords(records: CanonicalRecord[], eventRoleName: string, today = new Date().toISOString().slice(0, 10)): EventSuggestion[] {
  const overview = eventStaffingOverviewFromRecords(records);
  const role = overview.eventRoles.find(item => item.label.toLocaleLowerCase("en-GB") === eventRoleName.trim().toLocaleLowerCase("en-GB"));
  if (!role) return [];
  const activeLegendIds = new Set(overview.legends.filter(item => !item.terminated).map(item => item.canonicalId));
  const teamsByLegend = new Map<string, string[]>();
  overview.memberships.filter(item => item.lifecycleState === "active" && activeOn(item, today)).forEach(item => teamsByLegend.set(item.legendId, [...(teamsByLegend.get(item.legendId) || []), item.teamLabel]));
  const ordered = overview.preferences.filter(item => item.eventRoleId === role.canonicalId && item.lifecycleState === "active" && activeOn(item, today) && activeLegendIds.has(item.legendId)).map(item => ({ legendId: item.legendId, label: item.legendLabel, eventRoleId: role.canonicalId, eventRoleLabel: role.label, eligibility: item.eligibility, suggestionRank: item.suggestionRank, teams: teamsByLegend.get(item.legendId) || [], reason: `${title(item.eligibility)} eligibility · rank ${item.suggestionRank}${(teamsByLegend.get(item.legendId) || []).length ? ` · ${(teamsByLegend.get(item.legendId) || []).join(", ")}` : ""}` })).sort((a,b) => tiers[a.eligibility] - tiers[b.eligibility] || a.suggestionRank - b.suggestionRank || a.label.localeCompare(b.label));
  return ordered.filter((item, index) => ordered.findIndex(candidate => candidate.legendId === item.legendId) === index);
}

export async function saveEventStaffing(actor: Actor, command: EventStaffingCommand) {
  const entityType = entityFor(command.action); const canonicalId = command.canonicalId || generateCanonicalId(entityType);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(canonical()); const records = snapshot.docs.map(document => document.data() as CanonicalRecord); const current = records.find(record => record.canonicalId === canonicalId);
    if (command.canonicalId && (!current || current.entityType !== entityType)) throw conflict(`${entityType} was not found.`);
    if (current && Number(current.record.version) !== Number(command.expectedVersion)) throw conflict("This record changed elsewhere. Refresh and try again.");
    validate(records, command, canonicalId); const now = new Date().toISOString(); const record = build(entityType, canonicalId, actor, now, current, command); const parsed = parseCanonical(entityType, record);
    if (!parsed.success) throw conflict(`${entityType} validation failed: ${parsed.error.issues[0]?.message || "Review the values."}`);
    const next: CanonicalRecord = { canonicalId, entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: current?.lifecycleStatus || "needs-review" };
    writeHistory(transaction, actor, current || null, next, command.action, now);
  });
  return eventStaffingOverview();
}

function validate(records: CanonicalRecord[], command: EventStaffingCommand, currentId: string) {
  if ("effectiveTo" in command && command.effectiveTo && command.effectiveTo < command.effectiveFrom) throw conflict("Effective until cannot be before effective from.");
  if (command.action === "save-team-membership") { assertActiveLegend(records, command.legendId); assertActive(records, "Operational Team", command.teamId); duplicate(records, "Team Membership", currentId, r => r.record.legendId === command.legendId && r.record.teamId === command.teamId && r.record.lifecycleState === "active" && overlap(command.effectiveFrom, command.effectiveTo, String(r.record.effectiveFrom || ""), text(r.record.effectiveTo)), "This Legend already has an overlapping active membership of the selected team."); }
  if (command.action === "save-event-staffing-preference") { if (!Number.isInteger(command.suggestionRank) || command.suggestionRank < 1) throw conflict("Suggestion rank must be a positive whole number."); assertActiveLegend(records, command.legendId); assertActive(records, "Event Role", command.eventRoleId); duplicate(records, "Event Staffing Preference", currentId, r => r.record.legendId === command.legendId && r.record.eventRoleId === command.eventRoleId && r.record.eligibility === command.eligibility && r.record.lifecycleState === "active" && overlap(command.effectiveFrom, command.effectiveTo, String(r.record.effectiveFrom || ""), text(r.record.effectiveTo)), "This Legend already has an overlapping active preference for this Event Role and eligibility tier."); }
}

function assertActiveLegend(records: CanonicalRecord[], id: string) { const legend = records.find(r => r.canonicalId === id && r.entityType === "Legend" && r.lifecycleStatus !== "archived"); const employments = records.filter(r => r.entityType === "Employment" && r.lifecycleStatus !== "archived"); if (!legend || isTerminatedLegend(legend, employments)) throw conflict("Choose an active Legend. Terminated Legends retain history but cannot receive a new preference or team membership."); }
function assertActive(records: CanonicalRecord[], type: CanonicalEntityType, id: string) { if (!records.some(r => r.canonicalId === id && r.entityType === type && r.lifecycleStatus !== "archived" && r.record.lifecycleState === "active")) throw conflict(`Choose an active ${type}.`); }
function duplicate(records: CanonicalRecord[], type: CanonicalEntityType, currentId: string, predicate: (record: CanonicalRecord) => boolean, message: string) { if (records.some(r => r.entityType === type && r.canonicalId !== currentId && r.lifecycleStatus !== "archived" && predicate(r))) throw conflict(message); }
function build(entityType: "Operational Team" | "Team Membership" | "Event Role" | "Event Staffing Preference", canonicalId: string, actor: Actor, now: string, current: CanonicalRecord | undefined, command: EventStaffingCommand) { const base = current ? { ...structuredClone(current.record), version: Number(current.record.version || 0) + 1, updatedAt: now, updatedBy: actor.uid } : { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: { developmentModel: true } } }; const common = { ...base, entityType, canonicalId }; if (command.action === "save-operational-team") return { ...common, teamName: command.teamName.trim(), ...maybe("description", command.description), lifecycleState: command.lifecycleState }; if (command.action === "save-event-role") return { ...common, roleName: command.roleName.trim(), ...maybe("description", command.description), lifecycleState: command.lifecycleState }; if (command.action === "save-team-membership") return { ...common, legendId: command.legendId, teamId: command.teamId, effectiveFrom: command.effectiveFrom, ...maybe("effectiveTo", command.effectiveTo), ...maybe("notes", command.notes), lifecycleState: command.lifecycleState }; return { ...common, legendId: command.legendId, eventRoleId: command.eventRoleId, eligibility: command.eligibility, suggestionRank: command.suggestionRank, effectiveFrom: command.effectiveFrom, ...maybe("effectiveTo", command.effectiveTo), ...maybe("notes", command.notes), lifecycleState: command.lifecycleState }; }
function entityFor(action: EventStaffingCommand["action"]): "Operational Team" | "Team Membership" | "Event Role" | "Event Staffing Preference" { return ({ "save-operational-team": "Operational Team", "save-team-membership": "Team Membership", "save-event-role": "Event Role", "save-event-staffing-preference": "Event Staffing Preference" } as const)[action]; }
function named(records: CanonicalRecord[], type: CanonicalEntityType, field: string) { return records.filter(r => r.entityType === type && r.lifecycleStatus !== "archived" && r.record.lifecycleState === "active").map(r => ({ canonicalId: r.canonicalId, label: String(r.record[field] || r.canonicalId), description: text(r.record.description), version: Number(r.record.version || 0) })).sort(byLabel); }
function writeHistory(transaction: FirebaseFirestore.Transaction, actor: Actor, previous: CanonicalRecord | null, next: CanonicalRecord, action: string, now: string) { transaction.set(canonical().doc(stableDocumentId(next.canonicalId)), next); transaction.set(revisions().doc(stableDocumentId(`${next.canonicalId}:${next.record.version}`)), { revisionId: `canonical-revision:${stableDocumentId(`${next.canonicalId}:${next.record.version}`)}`, canonicalId: next.canonicalId, entityType: next.entityType, version: next.record.version, previous, current: next, changes: [{ path: action, before: previous?.record || null, after: next.record }], actorId: actor.uid, actorName: actor.name, reason: `${previous ? "Updated" : "Created"} ${next.entityType} through the governed Connections workspace.`, recordedAt: now }); transaction.set(audit().doc(crypto.randomUUID()), { auditId: crypto.randomUUID(), action: `${next.entityType} ${previous ? "updated" : "created"}`, entityReference: next.canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: "Governed team membership or Event staffing preference.", legendId: next.record.legendId || null }); }
function activeOn(record: Record<string, unknown> | { effectiveFrom: string; effectiveTo?: string }, today: string) { const from = String(record.effectiveFrom || ""); const until = text(record.effectiveTo); return Boolean(from && from <= today && (!until || until >= today)); }
function overlap(a: string, b: string | undefined, c: string, d: string | undefined) { return a <= (d || "9999-12-31") && c <= (b || "9999-12-31"); }
function maybe(key: string, value: unknown) { const content = text(value); return content ? { [key]: content } : {}; }
function text(value: unknown) { const output = String(value || "").trim(); return output || undefined; }
function byLabel(a: { label: string }, b: { label: string }) { return a.label.localeCompare(b.label); }
function title(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function conflict(message: string) { return Object.assign(new Error(message), { status: 409 }); }
