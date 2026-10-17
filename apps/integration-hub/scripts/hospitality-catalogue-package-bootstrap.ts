/** Explicit release action to build both private and public read packages from fika-os-dev. */
export {};

const expectedArgument = "--project=fika-os-dev";
if (!process.argv.slice(2).includes(expectedArgument) || process.argv.slice(2).some(value => value.startsWith("--project=") && value !== expectedArgument)) {
  throw new Error(`Refusing package bootstrap. The only supported target is ${expectedArgument}.`);
}

process.env.FIKA_RUNTIME_MODE = "staging";
process.env.FIREBASE_PROJECT_ID = "fika-os-dev";
process.env.FIKA_SNAPSHOT_BUCKET = "fika-os-dev-staging-read-packages-europe-west4";
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const [{ rebuildCataloguePackage, getPublicCataloguePackageManifest, getPublicCataloguePackageBytes }, { decodeReadPackage }] = await Promise.all([
  import("../lib/hospitality-catalogue-package"),
  import("@fika/server-shared/read-package"),
]);

const internal = await rebuildCataloguePackage();
const manifest = await getPublicCataloguePackageManifest();
if (!manifest || manifest.dataset !== "hospitality-booking/catalogue") throw new Error("The public Hospitality package manifest was not published.");
const artifact = await getPublicCataloguePackageBytes(manifest.contentHash);
if (!artifact) throw new Error("The public Hospitality package bytes are unavailable after bootstrap.");
const catalogue = decodeReadPackage<{ schemaVersion: number; contract: string; items: Array<Record<string, unknown>>; exceptions: unknown[]; oplocs: unknown[] }>(manifest, artifact.bytes);
if (catalogue.items.some(item => Object.hasOwn(item, "routing"))) throw new Error("The public package contains private production routing fields.");

console.log(JSON.stringify({
  project: "fika-os-dev",
  storageBucket: "fika-os-dev-staging-read-packages-europe-west4",
  internalPackageVersion: internal.manifest.packageVersion,
  publicManifest: manifest,
  itemCount: catalogue.items.length,
  exceptionCount: catalogue.exceptions.length,
  oplocCount: catalogue.oplocs.length,
  routingRedacted: true,
  firestoreMutation: false,
}, null, 2));
