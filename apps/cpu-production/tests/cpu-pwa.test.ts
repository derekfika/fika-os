import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import manifest from "../app/manifest";
import { CPU_PWA_BACKGROUND_COLOR, CPU_PWA_THEME_COLOR } from "../lib/cpu-pwa";
import { cpuSignInUrl, redirectExpiredCpuSession } from "../app/lib/cpu-session-navigation";
import { loadCpuDashboardProjection } from "../app/lib/cpu-dashboard-projection-loader";
import { loadCpuAllergenProjection } from "../app/lib/cpu-allergen-projection-loader";

test("expired allergen session fails before reading or storing operational cache", async () => {
  let reads = 0;
  await assert.rejects(loadCpuAllergenProjection("2026-10-14", "delivered_in", {
    fetch: (async (_input, init) => {
      assert.equal(init?.cache, "no-store");
      return new Response(JSON.stringify({ error: { message: "Session expired" } }), { status: 401 });
    }) as typeof fetch,
    read: async () => { reads++; return undefined; },
    write: async () => { throw new Error("Must not store an expired session"); },
  }), /Session expired/);
  assert.equal(reads, 0);
});

test("CPU manifest installs the direct CPU entry on its own origin in either orientation", () => {
  const value = manifest();
  assert.equal(value.name, "FIKA CPU Production");
  assert.equal(value.short_name, "FIKA CPU");
  assert.equal(value.id, "/");
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.display, "standalone");
  assert.equal(value.orientation, "any");
  assert.equal(value.prefer_related_applications, false);
  assert.equal(new URL(value.start_url!, "https://cpu-staging.fikacatering.com").href, "https://cpu-staging.fikacatering.com/");
});

test("install icon files are actual 192/512 PNGs, with a separate padded maskable icon and Apple icon", () => {
  const icons = manifest().icons!;
  assert.ok(icons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(icons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  for (const icon of [...icons, { src: "/icons/cpu-apple-180.png", sizes: "180x180", type: "image/png" }]) {
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const [width, height] = icon.sizes!.split("x").map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
});

test("metadata colours mirror existing CPU tokens; shell does not add an offline worker or zoom/orientation lock", () => {
  const tokens = readFileSync(new URL("../app/fika-tokens.css", import.meta.url), "utf8");
  assert.ok(tokens.includes(`--brand-primary:${CPU_PWA_THEME_COLOR}`));
  assert.ok(tokens.includes(`--background:${CPU_PWA_BACKGROUND_COLOR}`));
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /manifest: "\/manifest.webmanifest"/);
  assert.match(layout, /themeColor: CPU_PWA_THEME_COLOR/);
  assert.doesNotMatch(layout, /maximumScale|userScalable|serviceWorker/);
  assert.match(layout, /cpu-tablet.css/);
  const publicFiles = readdirSync(new URL("../public/", import.meta.url), { recursive: true }).map(String);
  assert.ok(!publicFiles.some(name => /(?:^|[/\\])(?:sw|service-worker)\.js$/.test(name)));
});

test("expired session uses existing Hub sign-in with direct CPU return and does not redirect 403/5xx", () => {
  const location = { href: "https://cpu-staging.fikacatering.com/allergens?date=2026-10-14", assign: (target: string) => { targets.push(target); } };
  const targets: string[] = [];
  const hub = "https://staging-os.fikacatering.com";
  assert.equal(redirectExpiredCpuSession({ status: 401 }, location, hub), true);
  const target = new URL(targets[0]);
  assert.equal(target.origin, hub);
  assert.equal(target.searchParams.get("returnTo"), location.href);
  assert.equal(target.searchParams.get("appId"), "cpu-production");
  assert.equal(target.searchParams.get("launchError"), "FIKA_SESSION_INVALID");
  for (const status of [200, 403, 500, 503]) assert.equal(redirectExpiredCpuSession({ status }, location, hub), false);
  assert.equal(targets.length, 1);
  assert.equal(cpuSignInUrl("https://cpu-staging.fikacatering.com/", hub), `${hub}/?returnTo=https%3A%2F%2Fcpu-staging.fikacatering.com%2F&appId=cpu-production&launchError=FIKA_SESSION_INVALID`);
});

test("expired initial session does not read or render existing IndexedDB operational data", async () => {
  let reads = 0;
  let renders = 0;
  const result = await loadCpuDashboardProjection({ view: "week", date: "2026-10-12", scope: "all" }, () => { renders++; }, {
    fetch: (async (_input, init) => { assert.equal(init?.cache, "no-store"); return new Response(JSON.stringify({ error: { message: "Session expired" } }), { status: 401 }); }) as typeof fetch,
    read: async () => { reads++; return undefined; },
    write: async () => { throw new Error("Must not store an expired-session response"); },
  });
  assert.equal(result.error, "Session expired");
  assert.equal(reads, 0);
  assert.equal(renders, 0);
});

test("session expiring during a warm manifest check does not return the cached projection as a successful result", async () => {
  let requests = 0;
  const result = await loadCpuDashboardProjection({ view: "week", date: "2026-10-12", scope: "all" }, undefined, {
    fetch: (async (_input, init) => { assert.equal(init?.cache, "no-store"); return ++requests === 1 ? new Response(JSON.stringify({ cacheScope: "actor" })) : new Response("{}", { status: 401 }); }) as typeof fetch,
    read: async () => ({ key: "week:2026-10-12:all", schemaVersion: 1, cacheScope: "actor", fetchedAt: "2026-10-14", lastChangeSequence: 1, revision: 1, packageVersion: 1, contentHash: "test", sourceVersion: "test", authorityBindingVersion: 1, value: { authorityBindingVersion: 1 } }),
    write: async () => { throw new Error("Must not store an expired-session response"); },
  });
  assert.match(result.error!, /session has expired/);
  assert.equal(result.projection, undefined);
});
