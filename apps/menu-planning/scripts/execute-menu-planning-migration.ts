import { Firestore } from "@google-cloud/firestore";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SOURCE_FINGERPRINT = "521e65fddc191d7f808a64d86ccf231aff7223dd5cd89a7705448f5cad5372ac";
const root = resolve(process.cwd(), "local-data", "menu-planning");
const source = join(root, "operational.sqlite");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const collectionNames = ["fikaMenuPlanningWeeks", "fikaMenuPlanningPublications", "fikaMenuPlanningEvents", "fikaMenuPlanningOutbox", "fikaMenuPlanningArchiveMetadata", "fikaMenuPlanningCatalogue"] as const;
type Write = { collection: string; id: string; data: Record<string, unknown> };

if (!process.argv.includes("--write")) throw new Error("Migration writes require the explicit --write flag.");
if (fileHash(source) !== SOURCE_FINGERPRINT) throw new Error("Authoritative operational.sqlite fingerprint changed; migration stopped.");
const db = new DatabaseSync(source, { readOnly: true });
const rows = db.prepare("SELECT document_key, document_json FROM operational_documents ORDER BY document_key").all() as Array<{ document_key: string; document_json: string }>;
const documents = Object.fromEntries(rows.map(row => [row.document_key, JSON.parse(row.document_json)]));
const rolling = documents.rolling as { weeks: Array<Record<string, unknown>>; days: Array<Record<string, unknown>>; entries: Array<Record<string, unknown>> };
const publications = documents.publications as { publications: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> };
const catalogue = JSON.parse(readFileSync(join(root, "canonical-menu-items.json"), "utf8")) as { items: Array<Record<string, unknown>> };
const sandwiches = JSON.parse(readFileSync(join(root, "saved-sandwiches.json"), "utf8")) as Array<Record<string, unknown>>;
const writes: Write[] = [];
for (const week of rolling.weeks) writes.push({ collection: "fikaMenuPlanningWeeks", id: String(week.id), data: { ...clone(week), schemaVersion: "1.0.0" } });
for (const day of rolling.days) { const weekId = String(day.id).split(":day:")[0]; writes.push({ collection: "fikaMenuPlanningWeeks", id: `${weekId}/days/${String(day.id)}`, data: { ...clone(day), weekId, schemaVersion: "1.0.0" } }); }
for (const entry of rolling.entries) { const dayId = String(entry.dayId); const weekId = dayId.split(":day:")[0]; writes.push({ collection: "fikaMenuPlanningWeeks", id: `${weekId}/days/${dayId}/entries/${String(entry.id)}`, data: { ...clone(entry), weekId, schemaVersion: "1.0.0" } }); }
for (const publication of publications.publications) {
  const days = (publication.days || []) as Array<Record<string, unknown>>;
  const rootPublication = clone(publication); delete rootPublication.days;
  writes.push({ collection: "fikaMenuPlanningPublications", id: String(publication.publicationId), data: { ...rootPublication, schemaVersion: "1.0.0" } });
  for (const day of days) writes.push({ collection: "fikaMenuPlanningPublications", id: `${String(publication.publicationId)}/days/${String(day.publicationDayId)}`, data: { ...clone(day), publicationId: publication.publicationId, schemaVersion: "1.0.0" } });
  for (const day of days) if (day.driveArchive) writes.push({ collection: "fikaMenuPlanningArchiveMetadata", id: String(day.publicationDayId), data: { archiveId: day.publicationDayId, publicationId: publication.publicationId, publicationDayId: day.publicationDayId, ...clone(day.driveArchive), schemaVersion: "1.0.0" } });
}
for (const event of publications.events) { writes.push({ collection: "fikaMenuPlanningEvents", id: String(event.eventId), data: { ...clone(event), schemaVersion: "1.0.0" } }); writes.push({ collection: "fikaMenuPlanningOutbox", id: String(event.eventId), data: { ...clone(event), outboxStatus: event.delivery && (event.delivery as Record<string, unknown>).status, schemaVersion: "1.0.0" } }); }
for (const item of catalogue.items) writes.push({ collection: "fikaMenuPlanningCatalogue", id: String(item.canonicalId), data: { id: item.canonicalId, kind: "dish", source: "menu-planning-local", record: clone(item), reconciliationStatus: "unreconciled", schemaVersion: "1.0.0" } });
for (const sandwich of sandwiches) writes.push({ collection: "fikaMenuPlanningCatalogue", id: String(sandwich.id), data: { id: sandwich.id, kind: "sandwich", source: "menu-planning-local", record: clone(sandwich), reconciliationStatus: "unreconciled", schemaVersion: "1.0.0" } });
const firestore = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || "fika-os-dev", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
const refs = writes.map(write => ({ ...write, ref: write.collection === "fikaMenuPlanningWeeks" && write.id.includes("/entries/") ? firestore.collection("fikaMenuPlanningWeeks").doc(write.id.split("/days/")[0]).collection("days").doc(write.id.split("/days/")[1].split("/entries/")[0]).collection("entries").doc(write.id.split("/entries/")[1]) : write.collection === "fikaMenuPlanningWeeks" && write.id.includes("/days/") ? firestore.collection("fikaMenuPlanningWeeks").doc(write.id.split("/days/")[0]).collection("days").doc(write.id.split("/days/")[1]) : write.collection === "fikaMenuPlanningPublications" && write.id.includes("/days/") ? firestore.collection("fikaMenuPlanningPublications").doc(write.id.split("/days/")[0]).collection("days").doc(write.id.split("/days/")[1]) : firestore.collection(write.collection).doc(write.id) }));
const existing = new Map<string, Record<string, unknown>>();
for (const write of refs) { const snapshot = await write.ref.get(); if (snapshot.exists) existing.set(`${write.collection}/${write.id}`, snapshot.data() as Record<string, unknown>); }
let creates = 0; let identicalSkips = 0; let conflicts = 0;
for (const write of refs) { const old = existing.get(`${write.collection}/${write.id}`); if (!old) creates += 1; else if (hash(old) === hash(write.data)) identicalSkips += 1; else conflicts += 1; }
if (conflicts) throw new Error(`Migration stopped: ${conflicts} differing target records already exist.`);
const writer = firestore.bulkWriter();
for (const write of refs) if (!existing.has(`${write.collection}/${write.id}`)) writer.create(write.ref, write.data);
await writer.close();
const verification = await Promise.all(refs.map(async write => ({ write, snapshot: await write.ref.get() })));
const verificationFailures = verification.filter(item => !item.snapshot.exists || hash(item.snapshot.data()) !== hash(item.write.data));
if (verificationFailures.length) throw new Error(`Post-write verification failed for ${verificationFailures.length} target documents.`);
const projected = { fikaMenuPlanningWeeks: rolling.weeks.length, weekDays: rolling.days.length, dayEntries: rolling.entries.length, fikaMenuPlanningPublications: publications.publications.length, publicationDays: publications.publications.reduce((sum, publication) => sum + ((publication.days as unknown[]) || []).length, 0), fikaMenuPlanningEvents: publications.events.length, fikaMenuPlanningOutbox: publications.events.length, fikaMenuPlanningArchiveMetadata: writes.filter(write => write.collection === "fikaMenuPlanningArchiveMetadata").length, fikaMenuPlanningCatalogue: catalogue.items.length, fikaMenuPlanningSandwichSubtype: sandwiches.length };
const sourceHash = hash(documents); const mapping = { weeks: "rolling.weeks[*].id -> fikaMenuPlanningWeeks/{weekId}", days: "rolling.days[*].id -> fikaMenuPlanningWeeks/{weekId}/days/{dayId}", entries: "rolling.entries[*].id -> .../days/{dayId}/entries/{entryId}", publications: "publications.publications[*].publicationId -> fikaMenuPlanningPublications/{publicationId}", publicationDays: "publication.days[*].publicationDayId -> .../publications/{publicationId}/days/{publicationDayId}", events: "publications.events[*].eventId -> fikaMenuPlanningEvents/{eventId} and fikaMenuPlanningOutbox/{eventId}" };
console.log(JSON.stringify({ mode: "WRITE", source, sourceFingerprint: SOURCE_FINGERPRINT, writes: { CREATE: creates, IDENTICAL_SKIP: identicalSkips, CONFLICT: conflicts }, projected, sourceHash, projectedTargetHash: hash({ mapping, projected, sourceHash }) }, null, 2));
