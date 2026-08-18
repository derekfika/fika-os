import fs from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase-admin";
import { scanAngelCourtAttachments, type AngelCourtInboxAttachment, type AngelCourtInboxMetadata } from "../lib/angel-court-inbox";

type FixtureEntry = AngelCourtInboxMetadata & { file: string };

function fixtureRoot() {
  const configured = process.env.ANGEL_COURT_FIXTURE_DIR || path.join(process.cwd(), "local-fixtures", "angel-court");
  const root = path.resolve(configured);
  const repositoryRoot = path.resolve(process.cwd(), "..", "..");
  if (root !== repositoryRoot && !root.startsWith(repositoryRoot + path.sep)) throw new Error("Fixture directory must remain inside the local repository.");
  return root;
}

async function main() {
  const root = fixtureRoot();
  const manifestPath = path.join(root, "manifest.json");
  const entries = JSON.parse(await fs.readFile(manifestPath, "utf8")) as FixtureEntry[];
  const attachments: AngelCourtInboxAttachment[] = await Promise.all(entries.map(async (entry) => ({
    ...entry,
    content: await fs.readFile(path.resolve(root, entry.file)),
  })));
  const existing = await db.collection("angelCourtInboxCandidates").select("sourceKey").get();
  const processed = new Set(existing.docs.map((doc) => String(doc.get("sourceKey"))));
  const result = scanAngelCourtAttachments(attachments, processed);
  const run = await db.collection("angelCourtInboxRuns").add({
    mode: "local-fixture",
    adapterVersion: result.candidates[0]?.adapterVersion || "fika.angel-court-inbox-adapter.v1",
    sourceCount: attachments.length,
    importedCount: result.candidates.length,
    skippedCount: result.skipped.length,
    createdAt: FieldValue.serverTimestamp(),
  });
  const batch = db.batch();
  for (const candidate of result.candidates) {
    const id = candidate.sourceKey.replace(/[^A-Za-z0-9_-]/g, "_");
    batch.set(db.collection("angelCourtInboxCandidates").doc(id), {
      sourceKey: candidate.sourceKey,
      runId: run.id,
      reviewState: candidate.warnings.length ? "needs_review" : "ready_for_review",
      canonicalWrite: "disabled",
      candidate,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(JSON.stringify({ runId: run.id, imported: result.candidates.length, skipped: result.skipped.length, collection: "angelCourtInboxCandidates" }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

