import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const expectedFingerprint = "521e65fddc191d7f808a64d86ccf231aff7223dd5cd89a7705448f5cad5372ac";
const root = resolve(process.cwd(), "local-data", "menu-planning");
const source = join(root, "operational.sqlite");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const unique = (items: unknown[], field: string) => new Set(items.map(item => (item as Record<string, unknown>)[field]).filter(Boolean));

if (process.argv.includes("--write")) throw new Error("Phase 2A is dry-run only; --write is deliberately unsupported.");
if (fileDigest(source) !== expectedFingerprint) throw new Error(`Source fingerprint mismatch for ${source}; migration is blocked.`);
const db = new DatabaseSync(source, { readOnly: true });
const rows = db.prepare("SELECT document_key, document_json FROM operational_documents ORDER BY document_key").all() as Array<{ document_key: string; document_json: string }>;
const documents = Object.fromEntries(rows.map(row => [row.document_key, JSON.parse(row.document_json)]));
const rolling = documents.rolling as { weeks: unknown[]; days: unknown[]; entries: unknown[] };
const publications = documents.publications as { publications: Array<Record<string, unknown>>; events: unknown[] };
const pubDays = publications.publications.flatMap(publication => (publication.days as unknown[] | undefined) || []);
const weekIds = unique(rolling.weeks, "id"); const dayIds = unique(rolling.days, "id"); const entryIds = unique(rolling.entries, "id");
const publicationIds = unique(publications.publications, "publicationId"); const publicationDayIds = unique(pubDays, "publicationDayId"); const eventIds = unique(publications.events, "eventId");
const unresolved: string[] = [];
for (const entry of rolling.entries as Array<Record<string, unknown>>) {
  if (!dayIds.has(entry.dayId)) unresolved.push(`entry:${String(entry.id)} -> missing day ${String(entry.dayId)}`);
  for (const allocation of (entry.allocations as Array<Record<string, unknown>> | undefined) || []) if (!allocation.destinationId) unresolved.push(`entry:${String(entry.id)} -> allocation has no destinationId`);
}
for (const publication of publications.publications) {
  if (!weekIds.has(publication.sourceWeekId)) unresolved.push(`publication:${String(publication.publicationId)} -> missing week ${String(publication.sourceWeekId)}`);
  for (const day of (publication.days as Array<Record<string, unknown>> || [])) if (!dayIds.has(day.sourceDayId)) unresolved.push(`publication-day:${String(day.publicationDayId)} -> missing source day ${String(day.sourceDayId)}`);
}
const projected = { fikaMenuPlanningWeeks: rolling.weeks.length, weekDays: rolling.days.length, dayEntries: rolling.entries.length, fikaMenuPlanningPublications: publications.publications.length, publicationDays: pubDays.length, fikaMenuPlanningEvents: publications.events.length, fikaMenuPlanningOutbox: publications.events.length, fikaMenuPlanningArchiveMetadata: pubDays.filter(day => Boolean((day as Record<string, unknown>).driveArchive)).length, fikaMenuPlanningCatalogue: 344, fikaMenuPlanningSandwichSubtype: 5 };
const mapping = { weeks: "rolling.weeks[*].id -> fikaMenuPlanningWeeks/{weekId}", days: "rolling.days[*].id -> fikaMenuPlanningWeeks/{weekId}/days/{dayId}", entries: "rolling.entries[*].id -> .../days/{dayId}/entries/{entryId}", publications: "publications.publications[*].publicationId -> fikaMenuPlanningPublications/{publicationId}", publicationDays: "publication.days[*].publicationDayId -> .../publications/{publicationId}/days/{publicationDayId}", events: "publications.events[*].eventId -> fikaMenuPlanningEvents/{eventId} and fikaMenuPlanningOutbox/{eventId}" };
const sourceHash = digest(documents);
console.log(JSON.stringify({ mode: "DRY_RUN", source, sourceFingerprint: expectedFingerprint, excludedSources: ["operational.test.sqlite", "operational.sqlite.clean-test-result", "operational.sqlite.hardening-test-backup", "*.json seeds", "fixtures/*", "in-memory /api/menu"], targetDocumentCounts: projected, sourceToTargetIdMapping: mapping, oplocMappings: [{ localId: "oploc:4e7b2838-95de-49c8-bf04-55200841d4cb", label: "Wise", targetId: "oploc:4e7b2838-95de-49c8-bf04-55200841d4cb", evidence: "Live fika-os-dev integrationHubCanonical OPLOC: approvedName=Wise, lifecycleState=active, publicationStatus=published" }], catalogueReconciliation: { dishes: { sourceCount: 344, classifications: { UNRECONCILED_PRESERVE_LOCAL_ID: 344, SEMANTIC_AUTO_MERGE: 0 } }, sandwiches: { sourceCount: 5, classification: "UNRECONCILED_PRESERVE_LOCAL_ID_AS_KIND_SANDWICH" } }, unresolvedReferences: unresolved, duplicateConflictClassification: { duplicateWeekIds: rolling.weeks.length - weekIds.size, duplicateDayIds: rolling.days.length - dayIds.size, duplicateEntryIds: rolling.entries.length - entryIds.size, duplicatePublicationIds: publications.publications.length - publicationIds.size, duplicatePublicationDayIds: pubDays.length - publicationDayIds.size, duplicateEventIds: publications.events.length - eventIds.size }, expectedActions: { CREATE: Object.values(projected).reduce((sum, count) => sum + count, 0), IDENTICAL_SKIP: 0, CONFLICT: 0 }, sourceHash, projectedTargetHash: digest({ mapping, projected, sourceHash }) }, null, 2));
