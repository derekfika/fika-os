import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";
import { getHubBaseUrl, getServiceToken } from "../lib/hub-client";

const root = path.resolve(import.meta.dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => { const full = path.join(dir, name); return statSync(full).isDirectory() ? (["node_modules", ".next", "docs", "public"].includes(name) ? [] : files(full)) : /\.(ts|tsx|css|json)$/.test(name) ? [full] : []; });
const sources = () => files(root).filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith("next-env.d.ts"));
const importsOf = (source: string) => [...source.matchAll(/(?:from\s+|import\s*\(|require\()\s*["']([^"']+)["']/g)].map(match => match[1]);

test("Ad-Hoc imports no Integration Hub source: Hub is reached only over HTTP", () => {
  for (const file of sources()) for (const specifier of importsOf(readFileSync(file, "utf8"))) {
    assert.doesNotMatch(specifier, /@hub\/|integration-hub|^@\/lib/, `${path.relative(root, file)} imports ${specifier}`);
  }
  const tsconfig = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  assert.equal(JSON.stringify(tsconfig.compilerOptions.paths || {}).includes("integration-hub"), false, "no tsconfig alias to Hub source");
});

test("relative imports leave the app only for the dependency-free shared contract", () => {
  const outside = new Set<string>();
  for (const file of sources()) for (const specifier of importsOf(readFileSync(file, "utf8"))) {
    if (!specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    if (!target.startsWith(root + path.sep)) outside.add(path.relative(path.resolve(root, ".."), target).replaceAll("\\", "/"));
  }
  assert.deepEqual([...outside], ["shared/ad-hoc-production-contract"]);
  const contract = readFileSync(path.resolve(root, "../shared/ad-hoc-production-contract.ts"), "utf8");
  assert.deepEqual(importsOf(contract), [], "the contract has no imports at all (no runtime dependencies)");
});

test("every bare package the app imports is declared in its own package.json", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const declared = new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.devDependencies || {})]);
  const builtins = new Set(["fs", "path", "http", "https", "url", "stream", "os", "util", "buffer", "events", "net", "tls", "zlib", "child_process", "worker_threads", "perf_hooks", "readline", "assert"]);
  const missing = new Set<string>();
  for (const file of sources()) for (const specifier of importsOf(readFileSync(file, "utf8"))) {
    if (specifier.startsWith(".") || specifier.startsWith("node:") || builtins.has(specifier) || specifier.startsWith("@/")) continue;
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (!declared.has(name)) missing.add(`${name} (${path.relative(root, file)})`);
  }
  assert.deepEqual([...missing], []);
});

test("the staging App Hosting config declares every variable the app reads at runtime", () => {
  const yaml = readFileSync(path.join(root, "apphosting.staging.yaml"), "utf8");
  for (const variable of ["FIKA_RUNTIME_MODE", "FIREBASE_PROJECT_ID", "FIKA_HUB_BASE_URL"]) assert.match(yaml, new RegExp(`variable:\\s*${variable}\\b`), `${variable} is configured`);
  assert.match(yaml, /FIKA_RUNTIME_MODE\s*\r?\n\s*value:\s*staging/, "staging is not local");
  assert.match(yaml, /FIKA_HUB_BASE_URL\s*\r?\n\s*value:\s*https:\/\//, "the Hub URL is HTTPS");
  assert.match(yaml, /variable:\s*FIKA_INTERNAL_API_TOKEN\s*\r?\n\s*secret:\s*\S+/, "the service token is a secret, never a literal value");
  assert.doesNotMatch(yaml, /FIKA_INTERNAL_API_TOKEN\s*\r?\n\s*value:/, "the token is never written into the config");
  assert.doesNotMatch(yaml, /FIKA_HUB_ORIGIN/, "the retired variable is gone");
});

test("the service token is only ever read in server-only modules, never in browser components", () => {
  for (const file of sources()) {
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["']/.test(source)) {
      assert.doesNotMatch(source, /FIKA_INTERNAL_API_TOKEN|x-fika-internal-token|process\.env/, `${path.relative(root, file)} is a client component`);
    }
  }
  const apis = files(path.join(root, "app")).filter(file => /route\.ts$/.test(file));
  for (const file of apis) assert.doesNotMatch(readFileSync(file, "utf8"), /FIKA_INTERNAL_API_TOKEN/, `${path.relative(root, file)} must not handle the token directly`);
});

test("the staging configuration, as App Hosting would inject it, yields a valid runtime and an approved HTTPS Hub origin", () => {
  const yaml = readFileSync(path.join(root, "apphosting.staging.yaml"), "utf8");
  const env: Record<string, string> = { FIKA_INTERNAL_API_TOKEN: "injected-from-secret-manager" };
  for (const match of yaml.matchAll(/variable:\s*(\w+)\s*\r?\n\s*value:\s*"?([^"\r\n]+)"?/g)) env[match[1]] = match[2].trim();
  assert.equal(getFikaRuntimeConfig(env).mode, "staging");
  assert.equal(getFikaRuntimeConfig(env).projectId, "fika-os-dev");
  assert.equal(getHubBaseUrl(env), "https://staging-os.fikacatering.com");
  assert.equal(getServiceToken(env), "injected-from-secret-manager");
  assert.throws(() => getServiceToken({ ...env, FIKA_INTERNAL_API_TOKEN: "" }), (error: any) => error.code === "AD_HOC_SERVICE_TOKEN_MISSING", "a missing secret fails closed");
});
