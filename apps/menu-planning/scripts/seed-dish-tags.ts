/**
 * Additive, staging-only seed of the approved Dish Library tag vocabulary.
 *
 *   npx tsx scripts/seed-dish-tags.ts --project fika-os-dev            # dry run (default)
 *   npx tsx scripts/seed-dish-tags.ts --project fika-os-dev --execute  # write
 *
 * It refuses any project other than the staging project, adds only missing tags, never edits or
 * removes one, assigns no tag to any dish, and is safe to re-run.
 */
export {};

const STAGING_PROJECT = "fika-os-dev";

const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1];
const execute = args.includes("--execute");

if (args.indexOf("--project") < 0 || project !== STAGING_PROJECT) {
  console.error(`Refusing to run: --project must be exactly "${STAGING_PROJECT}" (staging). Production is never seeded by this script.`);
  process.exit(2);
}

process.env.FIKA_RUNTIME_MODE = "staging";
process.env.FIREBASE_PROJECT_ID = STAGING_PROJECT;
process.env.GCLOUD_PROJECT = STAGING_PROJECT;

const { seedDishTags } = await import("../lib/dish-tag-store");
const { DISH_TAG_SEED, DISH_TAG_SEED_ACTOR, DISH_TAG_SEED_SOURCE } = await import("../lib/dish-tag-seed");

const result = await seedDishTags(DISH_TAG_SEED, DISH_TAG_SEED_ACTOR, { dryRun: !execute });
console.log(JSON.stringify({
  mode: execute ? "execute" : "dry-run",
  project: STAGING_PROJECT,
  source: DISH_TAG_SEED_SOURCE,
  seedTags: DISH_TAG_SEED.length,
  wouldAddOrAdded: result.added.length,
  alreadyPresent: DISH_TAG_SEED.length - result.added.length,
  wrote: result.wrote,
  registryVersion: result.registry.version,
  totalTagsAfter: result.wrote ? result.registry.tags.length : result.registry.tags.length + result.added.length,
}, null, 2));
