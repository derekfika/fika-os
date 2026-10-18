import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { credentialedUpstreamBase, publicHubBase } from "../lib/upstream-config";
import { forwardProductionMaterialisation } from "../lib/production-client";
import { NextRequest } from "next/server";
import { readAuthoritativeMenuPublications, resolveAccess } from "../lib/server";
import { getGrabAndGoCatalogueManifest } from "../lib/grab-and-go-catalogue-client";

test("production App Hosting config uses the variables read by Delivered-In", () => {
  const config = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
  assert.match(config, /variable:\s*INTEGRATION_HUB_BASE_URL[\s\S]*?value:\s*https:\/\/fika-os-prod-hub--fika-os\.europe-west4\.hosted\.app/);
  assert.match(config, /variable:\s*NEXT_PUBLIC_INTEGRATION_HUB_BASE_URL[\s\S]*?value:\s*https:\/\/os\.fikacatering\.com/);
  assert.match(config, /variable:\s*MENU_PLANNING_BASE_URL[\s\S]*?value:\s*https:\/\/fika-os-prod-menu--fika-os\.europe-west4\.hosted\.app/);
  assert.match(config, /variable:\s*CPU_PRODUCTION_BASE_URL[\s\S]*?value:\s*https:\/\/fika-os-prod-cpu--fika-os\.europe-west4\.hosted\.app/);
  assert.match(config, /variable:\s*NEXT_PUBLIC_FIKA_RUNTIME_MODE\s+value:\s*production/);
  assert.doesNotMatch(config, /staging|fika-os-dev/i);
});

test("production credentialed upstreams resolve only to their approved production origins", () => {
  assert.equal(credentialedUpstreamBase("hub", "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app", "http://localhost:3200", "production"), "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app");
  assert.equal(credentialedUpstreamBase("menu", "https://fika-os-prod-menu--fika-os.europe-west4.hosted.app", "http://localhost:3500", "production"), "https://fika-os-prod-menu--fika-os.europe-west4.hosted.app");
  assert.equal(credentialedUpstreamBase("cpu", "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app", "http://localhost:3400", "production"), "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app");
});

test("production rejects inherited staging and localhost upstreams before use", () => {
  for (const destination of [
    "https://staging-os.fikacatering.com",
    "http://localhost:3200",
    "https://unexpected.example",
  ]) {
    assert.throws(
      () => credentialedUpstreamBase("hub", destination, "http://localhost:3200", "production"),
      /credentials were not forwarded/,
    );
  }
});

test("a production internal-token request rejects a staging Hub before fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalBase = process.env.INTEGRATION_HUB_BASE_URL;
  const originalToken = process.env.FIKA_INTERNAL_API_TOKEN;
  let fetchCalls = 0;
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.INTEGRATION_HUB_BASE_URL = "https://staging-os.fikacatering.com";
  process.env.FIKA_INTERNAL_API_TOKEN = "test-token";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ cpuHandoff: "delivered" }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => forwardProductionMaterialisation({
      sourceDomain: "grab-and-go",
      sourceEntityId: "grab-and-go:site:one:2026-09-07",
      sourceVersion: 1,
      destinationOplocId: "oploc:site-one",
      destinationLabel: "One",
      serviceDate: "2026-09-07",
      requiredBy: "2026-09-07T08:00",
      status: "submitted",
      lines: [],
    }), /credentials were not forwarded/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalBase === undefined) delete process.env.INTEGRATION_HUB_BASE_URL; else process.env.INTEGRATION_HUB_BASE_URL = originalBase;
    if (originalToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = originalToken;
  }
});

test("a production cookie-bearing Hub request rejects staging before fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalBase = process.env.INTEGRATION_HUB_BASE_URL;
  let fetchCalls = 0;
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.INTEGRATION_HUB_BASE_URL = "https://staging-os.fikacatering.com";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ access: {}, sites: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => resolveAccess(new NextRequest("https://delivered-in.fikacatering.com/api/delivered-in/access", { headers: { cookie: "fika_hub_token=synthetic" } })),
      /credentials were not forwarded/,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalBase === undefined) delete process.env.INTEGRATION_HUB_BASE_URL; else process.env.INTEGRATION_HUB_BASE_URL = originalBase;
  }
});

test("production cookie-bearing Menu and internal-token CPU requests reject staging before fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalMenu = process.env.MENU_PLANNING_BASE_URL;
  const originalCpu = process.env.CPU_PRODUCTION_BASE_URL;
  const originalToken = process.env.FIKA_INTERNAL_API_TOKEN;
  let fetchCalls = 0;
  process.env.FIKA_RUNTIME_MODE = "production";
  process.env.MENU_PLANNING_BASE_URL = "https://menu-planning-staging.fikacatering.com";
  process.env.CPU_PRODUCTION_BASE_URL = "https://cpu-staging.fikacatering.com";
  process.env.FIKA_INTERNAL_API_TOKEN = "test-token";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ manifest: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => readAuthoritativeMenuPublications(new NextRequest("https://delivered-in.fikacatering.com/api/delivered-in", { headers: { cookie: "fika_hub_token=synthetic" } }), "2026-10-12", "2026-10-19"),
      /credentials were not forwarded/,
    );
    await assert.rejects(() => getGrabAndGoCatalogueManifest());
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalMenu === undefined) delete process.env.MENU_PLANNING_BASE_URL; else process.env.MENU_PLANNING_BASE_URL = originalMenu;
    if (originalCpu === undefined) delete process.env.CPU_PRODUCTION_BASE_URL; else process.env.CPU_PRODUCTION_BASE_URL = originalCpu;
    if (originalToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = originalToken;
  }
});

test("production browser redirect resolves only to the public production Hub", () => {
  assert.equal(publicHubBase("https://os.fikacatering.com", "production"), "https://os.fikacatering.com");
  assert.throws(() => publicHubBase("https://staging-os.fikacatering.com", "production"), /not the approved production Hub/);
  assert.throws(() => publicHubBase("http://localhost:3200", "production"), /not the approved production Hub/);
});

test("staging and local upstream configuration remains supported", () => {
  assert.equal(credentialedUpstreamBase("hub", "https://staging-os.fikacatering.com", "http://localhost:3200", "staging"), "https://staging-os.fikacatering.com");
  assert.equal(credentialedUpstreamBase("hub", undefined, "http://localhost:3200", "development"), "http://localhost:3200");
  assert.equal(publicHubBase("https://staging-os.fikacatering.com", "staging"), "https://staging-os.fikacatering.com");
  assert.equal(publicHubBase(undefined, "development"), "http://localhost:3200");
});
