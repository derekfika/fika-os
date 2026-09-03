import { Firestore, type DocumentReference, type WriteBatch } from "@google-cloud/firestore";

const OLD_ID_KEYS = new Set(["destinationId", "oplocId", "destinationOplocId", "operationalLocationId", "representedOplocId"]);
const writeRequested = process.argv.includes("--write");
const writeConfirmed = process.argv.includes("--confirm-staging");

if (writeRequested && (!writeConfirmed || process.env.FIKA_RUNTIME_MODE !== "staging")) {
  throw new Error("A write requires FIKA_RUNTIME_MODE=staging and --confirm-staging.");
}

type CanonicalOploc = { canonicalId?: string; entityType?: string; record?: { lifecycleState?: string; mergedIntoOplocId?: string; aliases?: Array<{ sourceReference?: unknown }> } };
type Change = { ref: DocumentReference; before: unknown; after: unknown; kind: string; immutable: boolean };

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID or GCLOUD_PROJECT is required.");
const db = new Firestore({ projectId });

function buildRedirects(records: CanonicalOploc[]) {
  const byId = new Map(records.filter(value => value.entityType === "OPLOC" && value.canonicalId).map(value => [value.canonicalId!, value]));
  const links = new Map<string, string>();
  for (const [id, record] of byId) {
    const successor = record.record?.lifecycleState === "merged" ? String(record.record.mergedIntoOplocId || "") : "";
    if (successor) links.set(id, successor);
    for (const alias of record.record?.aliases || []) {
      const sourceReference = typeof alias.sourceReference === "string" ? alias.sourceReference.trim() : "";
      if (sourceReference && sourceReference !== id) {
        const existing = links.get(sourceReference);
        if (existing && existing !== id) throw new Error(`OPLOC alias ${sourceReference} points to multiple survivors.`);
        links.set(sourceReference, id);
      }
    }
  }
  const redirects: Record<string, string> = {};
  for (const start of links.keys()) {
    let current = start;
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current)) throw new Error(`OPLOC merge cycle at ${current}.`);
      visited.add(current);
      const next = links.get(current) || "";
      if (!next) break;
      current = next;
    }
    if (current !== start) redirects[start] = current;
  }
  return redirects;
}

function replaceReferences(value: unknown, redirects: Readonly<Record<string, string>>, key = ""): { value: unknown; changed: boolean } {
  if (typeof value === "string" && OLD_ID_KEYS.has(key) && redirects[value]) return { value: redirects[value], changed: true };
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map(item => { const result = replaceReferences(item, redirects, key); changed ||= result.changed; return result.value; });
    return { value: changed ? next : value, changed };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  let changed = false;
  const next = Object.fromEntries(Object.entries(value).map(([name, item]) => { const result = replaceReferences(item, redirects, name); changed ||= result.changed; return [name, result.value]; }));
  return { value: changed ? next : value, changed };
}

function recordChange(changes: Change[], ref: DocumentReference, data: unknown, kind: string, immutable: boolean, redirects: Readonly<Record<string, string>>) {
  const result = replaceReferences(data, redirects);
  if (result.changed) changes.push({ ref, before: data, after: result.value, kind, immutable });
}

async function main() {
  const oplocSnapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get();
  const redirects = buildRedirects(oplocSnapshot.docs.map(doc => doc.data() as CanonicalOploc));
  const changes: Change[] = [];
  const counts: Record<string, number> = {};
  const scanRoot = async (collection: string, immutable: boolean) => {
    const snapshot = await db.collection(collection).get();
    counts[collection] = snapshot.size;
    for (const doc of snapshot.docs) recordChange(changes, doc.ref, doc.data(), collection, immutable, redirects);
    return snapshot.docs;
  };

  const weeks = await scanRoot("fikaMenuPlanningWeeks", false);
  for (const week of weeks) {
    const days = await week.ref.collection("days").get();
    counts[`${week.id}/days`] = days.size;
    for (const day of days.docs) {
      recordChange(changes, day.ref, day.data(), "fikaMenuPlanningWeeks/days", false, redirects);
      const entries = await day.ref.collection("entries").get();
      counts[`${week.id}/${day.id}/entries`] = entries.size;
      for (const entry of entries.docs) recordChange(changes, entry.ref, entry.data(), "fikaMenuPlanningWeeks/days/entries", false, redirects);
    }
  }
  const publications = await scanRoot("fikaMenuPlanningPublications", true);
  for (const publication of publications) {
    const days = await publication.ref.collection("days").get();
    counts[`${publication.id}/publication-days`] = days.size;
    for (const day of days.docs) recordChange(changes, day.ref, day.data(), "fikaMenuPlanningPublications/days", true, redirects);
  }
  await scanRoot("fikaMenuPlanningPublishedSnapshots", true);
  await scanRoot("fikaMenuPlanningEvents", true);
  await scanRoot("fikaMenuPlanningOutbox", false);
  await scanRoot("fikaMenuPlanningArchiveMetadata", true);
  await scanRoot("fikaMenuPlanningCatalogue", true);

  const mutable = changes.filter(change => !change.immutable);
  const immutable = changes.filter(change => change.immutable);
  const summary = {
    mode: writeRequested ? "write" : "dry-run",
    projectId,
    redirects,
    collections: counts,
    changedDocuments: changes.length,
    mutableDocuments: mutable.length,
    immutableDocumentsLeftUntouched: immutable.length,
    changedPaths: changes.map(change => ({ path: change.ref.path, kind: change.kind, immutable: change.immutable })),
  };

  if (writeRequested) {
    let batch: WriteBatch = db.batch();
    let operations = 0;
    const flush = async () => { if (operations) { await batch.commit(); batch = db.batch(); operations = 0; } };
    for (const change of mutable) {
      let after = change.after as Record<string, unknown>;
      if (change.kind === "fikaMenuPlanningWeeks") {
        const audit = Array.isArray(after.audit) ? after.audit : [];
        after = { ...after, version: Number(after.version || 0) + 1, audit: [...audit, { action: "oploc-references-canonicalised", at: new Date().toISOString(), by: "menu-planning-oploc-migration" }] };
      }
      batch.set(change.ref, after);
      operations += 1;
      if (operations >= 400) await flush();
    }
    await flush();
  }
  console.log(JSON.stringify(summary, null, 2));
}

await main();
