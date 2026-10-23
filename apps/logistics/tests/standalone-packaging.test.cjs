const assert = require("node:assert/strict");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const helperPath = path.join(__dirname, "..", "scripts", "prepare-standalone-assets.mjs");

async function fixture(t) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "fika-logistics-standalone-"));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  return appRoot;
}

test("standalone preparation requires the Firebase adapter app-root layout and copies runtime assets", async (t) => {
  const appRoot = await fixture(t);
  const standalone = path.join(appRoot, ".next", "standalone");
  await mkdir(path.join(standalone, ".next"), { recursive: true });
  await mkdir(path.join(standalone, "node_modules", "firebase-admin"), { recursive: true });
  await mkdir(path.join(appRoot, ".next", "static", "css"), { recursive: true });
  await mkdir(path.join(appRoot, "public"), { recursive: true });
  await writeFile(path.join(standalone, "server.js"), "// standalone server");
  await writeFile(path.join(standalone, ".next", "routes-manifest.json"), "{}");
  await writeFile(path.join(standalone, ".next", "BUILD_ID"), "test-build");
  await writeFile(path.join(standalone, "node_modules", "firebase-admin", "package.json"), "{}");
  await writeFile(path.join(appRoot, ".next", "static", "css", "app.css"), "body{}");
  await writeFile(path.join(appRoot, "public", "favicon.ico"), "public-asset");

  const { prepareStandaloneAssets } = await import(pathToFileURL(helperPath));
  const result = await prepareStandaloneAssets({ appRoot });

  assert.equal(result.standaloneRoot, standalone);
  assert.equal(await readFile(path.join(standalone, ".next", "static", "css", "app.css"), "utf8"), "body{}");
  assert.equal(await readFile(path.join(standalone, "public", "favicon.ico"), "utf8"), "public-asset");
});

test("standalone preparation rejects the nested monorepo output layout", async (t) => {
  const appRoot = await fixture(t);
  const nested = path.join(appRoot, ".next", "standalone", "apps", "logistics");
  await mkdir(path.join(nested, ".next"), { recursive: true });
  await writeFile(path.join(nested, "server.js"), "// nested server");
  await writeFile(path.join(nested, ".next", "routes-manifest.json"), "{}");
  await writeFile(path.join(nested, ".next", "BUILD_ID"), "nested-build");

  const { prepareStandaloneAssets } = await import(pathToFileURL(helperPath));
  await assert.rejects(
    prepareStandaloneAssets({ appRoot }),
    (error) => error.message.includes(path.join(".next", "standalone", "server.js")),
  );
});
