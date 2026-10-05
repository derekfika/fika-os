import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hostedExternalProductionConsumers = ["integration-hub", "cpu-production", "menu-planning", "delivered-in"] as const;
const sharedRuntimeDependencies = JSON.parse(readFileSync(new URL("../../../packages/server-shared/package.json", import.meta.url), "utf8")).dependencies;

test("App Hosting receives app-root standalone output", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /output:\s*["']standalone["']/);
  assert.match(config, /externalDir:\s*true/);
  assert.match(config, /outputFileTracingRoot:\s*appRoot/);
  assert.match(config, /webpack:\s*\(/);
});

test("hosted external-production consumers lock the shared package runtime dependencies", () => {
  for (const app of hostedExternalProductionConsumers) {
    const packageJson = JSON.parse(readFileSync(new URL(`../../${app}/package.json`, import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL(`../../${app}/package-lock.json`, import.meta.url), "utf8"));
    const npmConfig = readFileSync(new URL(`../../${app}/.npmrc`, import.meta.url), "utf8");
    const installedPackage = lock.packages["node_modules/@fika/server-shared"];

    assert.equal(packageJson.dependencies["@fika/server-shared"], "file:../../packages/server-shared", `${app} must use the canonical shared package`);
    assert.match(npmConfig, /^install-links=true\s*$/m, `${app} must use the install mode recorded in its lockfile`);
    assert.ok(installedPackage, `${app} lockfile must contain @fika/server-shared`);
    assert.equal(installedPackage.link, undefined, `${app} must install server-shared as a package instead of an out-of-tree symlink`);
    assert.equal(installedPackage.resolved, "file:../../packages/server-shared", `${app} must lock the shared package from the canonical local package path`);
    assert.deepEqual(installedPackage.dependencies, sharedRuntimeDependencies, `${app} lockfile must retain server-shared runtime dependencies`);

    for (const dependency of Object.keys(sharedRuntimeDependencies)) {
      assert.ok(lock.packages[`node_modules/${dependency}`], `${app} lockfile must materialize server-shared runtime dependency ${dependency}`);
    }
  }
});
