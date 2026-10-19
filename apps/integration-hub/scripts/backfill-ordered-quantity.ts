/**
 * One-order backfill of presentation-only ordered quantities (see lib/ordered-quantity-backfill.ts).
 * DRY RUN by default: reads only and prints the exact diff. A write needs --apply AND --confirm <same order id> AND --by <operator>.
 *
 *   tsx scripts/backfill-ordered-quantity.ts --project fika-os --order <production-order id>
 *   tsx scripts/backfill-ordered-quantity.ts --project fika-os --order <id> --apply --confirm <id> --by <name>
 */
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const project = argument("--project");
const orderId = argument("--order");
const apply = process.argv.includes("--apply");
if (project !== "fika-os") throw new Error("Explicit production project --project fika-os is required.");
if (!orderId?.startsWith("production-order:")) throw new Error("Exactly one --order production-order:... is required.");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Emulator configuration is forbidden for this production command.");
if (apply && (argument("--confirm") !== orderId || !argument("--by"))) throw new Error("--apply requires --confirm <the same order id> and --by <operator>.");
process.env.FIKA_RUNTIME_MODE = "production";
process.env.FIREBASE_PROJECT_ID = project;
process.env.GCLOUD_PROJECT = project;
const { db } = await import("../lib/firebase-admin");
const { planOrderedQuantityBackfill, applyOrderedQuantityBackfill } = await import("../lib/ordered-quantity-backfill");
const plan = await planOrderedQuantityBackfill(db, orderId);
const { patches: _patches, ...summary } = plan;
console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY RUN (no writes)", ...summary }, null, 2));
if (apply) {
  const result = await applyOrderedQuantityBackfill(db, orderId, argument("--by")!);
  console.log(JSON.stringify({ written: result.written }, null, 2));
}

export {};
