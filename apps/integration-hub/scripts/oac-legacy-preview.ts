import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOacLegacyPreview, type OacLegacyPreviewInput } from "../lib/oac-legacy-preview";

/** Redacted preview files only. No SDK, Firestore, Calendar, or mutation imports are used. */
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") {
    throw new Error("Usage: tsx scripts/oac-legacy-preview.ts --input REDACTED_INPUT.json --output OUTSIDE_REPOSITORY.json");
  }
  const inputPath = path.resolve(args[1]);
  const outputPath = path.resolve(args[3]);
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  if (inputPath === repository || inputPath.startsWith(repository + path.sep)
    || outputPath === repository || outputPath.startsWith(repository + path.sep)) {
    throw new Error("OAC preview input and output must remain outside the Git checkout.");
  }
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as OacLegacyPreviewInput;
  const plan = buildOacLegacyPreview(input);
  await fs.writeFile(outputPath, JSON.stringify(plan, null, 2), { flag: "wx" });
  console.log(JSON.stringify({
    sourceRows: plan.summary.sourceRows,
    actions: plan.summary.actions,
    rowsWithSourceQuoteReferences: plan.summary.rowsWithSourceQuoteReferences,
    rowsWithSourceCalendarReferences: plan.summary.rowsWithSourceCalendarReferences,
    sourceProjectionFingerprint: plan.sourceProjectionFingerprint,
    contextFingerprint: plan.contextFingerprint,
    planHash: plan.planHash,
    writes: plan.summary.writes,
    downstreamEffects: plan.summary.downstreamEffects,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
