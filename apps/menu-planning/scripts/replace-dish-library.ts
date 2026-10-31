/**
 * Governed Dish Library upgrade (staging only; dry-run by default).
 *
 *   npx tsx scripts/replace-dish-library.ts --project fika-os-dev --export-dir <dir> --assignments <file>            # dry run
 *   npx tsx scripts/replace-dish-library.ts --project fika-os-dev --export-dir <dir> --assignments <file> --execute  # write
 *
 * Replaces the environment's dish library with a reviewed export (original + archived JSON), applies the
 * approved tag assignments, and archives every old dish first. Nothing is merged and no dish is deleted:
 * old dishes that are not in the new library are kept as archived. It refuses to run if any currently
 * published dish on or after --from-date would be missing, archived or merged by the upgrade.
 * Production is never accepted here; see docs/deployment/dish-library-upgrade-runbook.md.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MenuItem } from "../lib/domain";

const STAGING_PROJECT = "fika-os-dev";
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const execute = args.includes("--execute");
const project = arg("--project");
const exportDir = arg("--export-dir");
const assignmentsFile = arg("--assignments");
const archiveId = arg("--archive-id") || `upgrade-${new Date().toISOString().slice(0, 10)}`;
const backupDir = arg("--backup-dir") || path.join(process.cwd(), "dish-library-upgrade-backups");

if (project !== STAGING_PROJECT) {
  console.error(`Refusing to run: --project must be exactly "${STAGING_PROJECT}" (staging). Production needs a separately approved run (see the runbook).`);
  process.exit(2);
}
if (!exportDir || !assignmentsFile) {
  console.error("Both --export-dir (the reviewed library export) and --assignments (the approved tag file) are required.");
  process.exit(2);
}

process.env.FIKA_RUNTIME_MODE = "staging";
process.env.FIREBASE_PROJECT_ID = STAGING_PROJECT;
process.env.GCLOUD_PROJECT = STAGING_PROJECT;

const { Firestore } = await import("@google-cloud/firestore");
const { readDishTagRegistry } = await import("../lib/dish-tag-store");
const { upsertCatalogueItemsInChunks } = await import("../lib/canonical-menu-repository");
const { checkPublishedReferences, planLibraryUpgrade, unexpectedChanges } = await import("../lib/dish-library-upgrade");

const actor = "upgrade:dish-library";
const at = new Date().toISOString();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const fromDate = arg("--from-date") || today;
const db = new Firestore({ projectId: STAGING_PROJECT });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readExport = (file: string) => (JSON.parse(readFileSync(path.join(exportDir!, file), "utf8")) as { records: Array<{ fields: { record: MenuItem } }> }).records.map((entry) => entry.fields.record);
const incoming = [...readExport("fika-dish-library-original.json"), ...readExport("fika-dish-library-archived.json")];
const assignments = JSON.parse(readFileSync(assignmentsFile, "utf8"));

const dishDocs = await db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
const currentDocs = dishDocs.docs.map((document) => ({ id: document.id, data: document.data() }));
const current = currentDocs.map((document) => (document.data.record || document.data) as MenuItem);
const registry = await readDishTagRegistry();
const manifestBefore = (await db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").get()).data() || {};

// Every dish a currently published menu uses from --from-date on must survive as an ACTIVE dish with the same ID.
const publications = await db.collection("fikaMenuPlanningPublications").limit(200).get();
const references: Array<{ publicationId: string; weekCommencing: string; date: string; slot: string; dishId: string; dishName: string }> = [];
let publishedDaysChecked = 0;
for (const publication of publications.docs) {
  const data = publication.data() as { publicationStatus?: string; weekCommencing?: string };
  if (data.publicationStatus === "withdrawn") continue;
  const days = await publication.ref.collection("days").get();
  for (const day of days.docs) {
    const dayData = day.data() as { status?: string; date?: string; entries?: Array<{ slot: string; canonicalDishId?: string; dishName: string }> };
    if (dayData.status !== "published" || !dayData.date || dayData.date < fromDate) continue;
    publishedDaysChecked++;
    for (const entry of dayData.entries || []) if (entry.canonicalDishId) references.push({ publicationId: publication.id, weekCommencing: data.weekCommencing || "", date: dayData.date, slot: entry.slot, dishId: entry.canonicalDishId, dishName: entry.dishName });
  }
}
// An old-only dish that a published menu still uses is kept active and unchanged instead of being archived.
const keepActiveIds = new Set(references.filter((reference) => reference.date >= fromDate).map((reference) => reference.dishId));
const plan = planLibraryUpgrade({ current, incoming, assignments, registry, actor, at, keepActiveIds });
const problems = checkPublishedReferences(references, plan.items, fromDate);

// Only tags, a salad slot, an audit line, the revision and the archive flag may differ from the source dish.
const sourceById = new Map([...current, ...incoming].map((item) => [item.canonicalId, item]));
const incomingById = new Map(incoming.map((item) => [item.canonicalId, item]));
const unexpected = plan.items.flatMap((item) => {
  const source = incomingById.get(item.canonicalId) || sourceById.get(item.canonicalId);
  return source ? unexpectedChanges(source, item).map((key) => `${item.canonicalId}:${key}`) : [];
});

const report = {
  mode: execute ? "execute" : "dry-run",
  project: STAGING_PROJECT,
  archiveId,
  fromDate,
  stats: plan.stats,
  finalActive: plan.items.filter((item) => item.reviewStatus !== "archived").length,
  finalArchived: plan.items.filter((item) => item.reviewStatus === "archived").length,
  nameCollisions: plan.nameCollisions,
  publishedCheck: { publications: publications.size, daysChecked: publishedDaysChecked, dishReferences: references.length, problems },
  unexpectedFieldChanges: unexpected,
  manifestBefore: { sourceRevision: manifestBefore.sourceRevision, dishCount: manifestBefore.dishCount },
};

const blocked = plan.nameCollisions.length > 0 || problems.length > 0 || unexpected.length > 0;
if (!execute || blocked) {
  console.log(JSON.stringify({ ...report, blocked, wrote: false }, null, 2));
  process.exit(blocked ? 3 : 0);
}

// 1. Archive every current document (raw) before any change, and prove the copy is complete.
mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `${archiveId}-staging-dishes-before.json`);
writeFileSync(backupFile, JSON.stringify(currentDocs, null, 1));
const archiveRoot = db.collection("fikaMenuPlanningCatalogueArchives").doc(archiveId);
if ((await archiveRoot.get()).exists) { console.error(`Archive ${archiveId} already exists; refusing to overwrite it.`); process.exit(4); }
for (let start = 0; start < currentDocs.length; start += 400) {
  const batch = db.batch();
  for (const document of currentDocs.slice(start, start + 400)) batch.set(archiveRoot.collection("dishes").doc(document.id.replace(/\//g, "_")), { id: document.id, archivedAt: at, data: document.data });
  await batch.commit();
}
const archived = await archiveRoot.collection("dishes").get();
if (archived.size !== currentDocs.length) { console.error(`Archive incomplete (${archived.size} of ${currentDocs.length}); nothing was changed.`); process.exit(5); }
await archiveRoot.set({ archiveId, createdAt: at, createdBy: actor, project: STAGING_PROJECT, dishCount: currentDocs.length, contentDigest: digest(currentDocs), manifestBefore, backupFile, planStats: plan.stats });

// 2. Write the new library through the app's own catalogue writer.
const written = await upsertCatalogueItemsInChunks(plan.items, { currentItems: current, actor });

// 3. Verify against Firestore, not the plan.
const after = await db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
const afterItems = new Map(after.docs.map((document) => [document.id, (document.data().record || document.data()) as MenuItem]));
const manifestAfter = (await db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue").get()).data() || {};
const missing = plan.items.filter((item) => !afterItems.has(item.canonicalId)).map((item) => item.canonicalId);
const wrongTags = plan.items.filter((item) => JSON.stringify(afterItems.get(item.canonicalId)?.tagIds || []) !== JSON.stringify(item.tagIds || [])).map((item) => item.canonicalId);
const wrongArchive = plan.items.filter((item) => (afterItems.get(item.canonicalId)?.reviewStatus === "archived") !== (item.reviewStatus === "archived")).map((item) => item.canonicalId);
console.log(JSON.stringify({
  ...report,
  blocked: false,
  wrote: true,
  written,
  verified: {
    docsAfter: after.size,
    expected: plan.items.length,
    missing: missing.length,
    tagMismatches: wrongTags.length,
    archiveFlagMismatches: wrongArchive.length,
    dishesWithTags: [...afterItems.values()].filter((item) => (item.tagIds || []).length).length,
    saladsWithSubtype: [...afterItems.values()].filter((item) => item.category === "Salad" && item.subcategory).length,
    manifestAfter: { sourceRevision: manifestAfter.sourceRevision, dishCount: manifestAfter.dishCount },
    archiveDishes: archived.size,
  },
}, null, 2));
process.exit(missing.length || wrongTags.length || wrongArchive.length ? 6 : 0);
