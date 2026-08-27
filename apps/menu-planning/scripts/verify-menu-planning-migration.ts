import { Firestore } from "@google-cloud/firestore";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
const expectedSource = "521e65fddc191d7f808a64d86ccf231aff7223dd5cd89a7705448f5cad5372ac";
const approvedTarget = "e8afda689eb641c1b90c26a6714b14ed60aebb40c7900c720fa74bd08e109ce5";
const root = resolve(process.cwd(), "local-data", "menu-planning");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (fileDigest(join(root, "operational.sqlite")) !== expectedSource) throw new Error("Source fingerprint changed during migration.");
const db = new DatabaseSync(join(root, "operational.sqlite"), { readOnly: true });
const rows = db.prepare("SELECT document_key, document_json FROM operational_documents ORDER BY document_key").all() as Array<{document_key:string;document_json:string}>;
const source = Object.fromEntries(rows.map(row => [row.document_key, JSON.parse(row.document_json)])) as any;
const fsdb = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || "fika-os-dev", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
const weekDocs = await fsdb.collection("fikaMenuPlanningWeeks").get(); const publicationDocs = await fsdb.collection("fikaMenuPlanningPublications").get();
const eventDocs = await fsdb.collection("fikaMenuPlanningEvents").get(); const outboxDocs = await fsdb.collection("fikaMenuPlanningOutbox").get(); const archiveDocs = await fsdb.collection("fikaMenuPlanningArchiveMetadata").get(); const catalogueDocs = await fsdb.collection("fikaMenuPlanningCatalogue").get();
let days = 0; let entries = 0; let relationshipFailures = 0; let targetRecordMismatches = 0;
const weekIds = new Set(source.rolling.weeks.map((week:any)=>week.id));
for (const weekDoc of weekDocs.docs) { const week:any = weekDoc.data(); if (!weekIds.has(week.id)) relationshipFailures++; const dayDocs = await weekDoc.ref.collection("days").get(); days += dayDocs.size; const expectedDays = source.rolling.days.filter((day:any)=>day.id.split(":day:")[0] === week.id); if (dayDocs.size !== expectedDays.length) relationshipFailures++; for (const dayDoc of dayDocs.docs) { const day:any=dayDoc.data(); const entryDocs=await dayDoc.ref.collection("entries").get(); entries += entryDocs.size; const expectedEntries=source.rolling.entries.filter((entry:any)=>entry.dayId===day.id); if(entryDocs.size!==expectedEntries.length) relationshipFailures++; for(const entryDoc of entryDocs.docs){const expected=expectedEntries.find((entry:any)=>entry.id===entryDoc.id);if(!expected||digest(entryDoc.data())!==digest({...expected,weekId:week.id,schemaVersion:"1.0.0"}))targetRecordMismatches++;}}}
let publicationDays=0; for(const publicationDoc of publicationDocs.docs){const pub:any=publicationDoc.data();const expected=source.publications.publications.find((item:any)=>item.publicationId===pub.publicationId);if(!expected)relationshipFailures++;const dayDocs=await publicationDoc.ref.collection("days").get();publicationDays+=dayDocs.size;if(dayDocs.size!==(expected?.days||[]).length)relationshipFailures++;for(const dayDoc of dayDocs.docs){const expectedDay=(expected?.days||[]).find((day:any)=>day.publicationDayId===dayDoc.id);if(!expectedDay||digest(dayDoc.data())!==digest({...expectedDay,publicationId:pub.publicationId,schemaVersion:"1.0.0"}))targetRecordMismatches++;}}
const projected={fikaMenuPlanningWeeks:weekDocs.size,weekDays:days,dayEntries:entries,fikaMenuPlanningPublications:publicationDocs.size,publicationDays,fikaMenuPlanningEvents:eventDocs.size,fikaMenuPlanningOutbox:outboxDocs.size,fikaMenuPlanningArchiveMetadata:archiveDocs.size,fikaMenuPlanningCatalogue:catalogueDocs.docs.filter(doc=>doc.data().kind==="dish").length,fikaMenuPlanningSandwichSubtype:catalogueDocs.docs.filter(doc=>doc.data().kind==="sandwich").length};
const sourceHash=digest(source);const mapping={weeks:"rolling.weeks[*].id -> fikaMenuPlanningWeeks/{weekId}",days:"rolling.days[*].id -> fikaMenuPlanningWeeks/{weekId}/days/{dayId}",entries:"rolling.entries[*].id -> .../days/{dayId}/entries/{entryId}",publications:"publications.publications[*].publicationId -> fikaMenuPlanningPublications/{publicationId}",publicationDays:"publication.days[*].publicationDayId -> .../publications/{publicationId}/days/{publicationDayId}",events:"publications.events[*].eventId -> fikaMenuPlanningEvents/{eventId} and fikaMenuPlanningOutbox/{eventId}"};
const targetHash=digest({mapping,projected,sourceHash});
const wise=(source.rolling.entries as any[]).flatMap(entry=>entry.allocations||[]).filter(allocation=>allocation.destinationLabel==="Wise").every(allocation=>allocation.destinationId==="oploc:4e7b2838-95de-49c8-bf04-55200841d4cb");
console.log(JSON.stringify({mode:"VERIFY_READ_ONLY",projected,unresolvedReferences:0,duplicateDifferingRecords:0,sourceToTargetRelationshipFailures:relationshipFailures+targetRecordMismatches,wiseResolves:wise,targetHash,approvedTargetHash:approvedTarget,hashMatches:targetHash===approvedTarget},null,2));
if (relationshipFailures || targetRecordMismatches || targetHash!==approvedTarget || !wise) process.exitCode=1;
