import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));

for (const van of ["1", "2"]) {
  test(`Van ${van} manifest has its own stable identity, launch URL, scope and icons`, () => {
    const manifest = JSON.parse(read(`public/pwa/manifest-van${van}.webmanifest`));
    assert.equal(manifest.id, `/mobile/van${van}`);
    assert.equal(manifest.start_url, `/mobile/van${van}`);
    assert.equal(manifest.scope, `/mobile/van${van}`);
    assert.equal(manifest.display, "standalone");
    assert.match(manifest.name, new RegExp(`FIKA Van ${van}`));
    for (const icon of manifest.icons) assert.ok(exists(`public${icon.src}`), `missing icon ${icon.src}`);
    assert.ok(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable"));
  });

  test(`Van ${van} route links its own manifest and home-screen icon`, () => {
    const page = read("app/mobile/[van]/page.tsx");
    assert.match(page, new RegExp(`manifest-van\\$\\{number\\}\\.webmanifest|/pwa/manifest-van${van}\\.webmanifest`));
    assert.match(page, /van-apple-touch-180\.png|apple-touch-180/);
    assert.ok(exists(`public/pwa/van${van}-apple-touch-180.png`));
  });
}

test("manifests never share an identity", () => {
  const one = JSON.parse(read("public/pwa/manifest-van1.webmanifest"));
  const two = JSON.parse(read("public/pwa/manifest-van2.webmanifest"));
  assert.notEqual(one.id, two.id);
  assert.notEqual(one.scope, two.scope);
  assert.notEqual(one.name, two.name);
});

test("service worker never intercepts or caches API responses or navigations", () => {
  const sw = read("public/pwa-sw.js");
  assert.match(sw, /if \(url\.pathname\.startsWith\("\/api\/"\)\) return;/);
  assert.match(sw, /request\.mode === "navigate"\)\s*\{\s*event\.respondWith\(fetch\(request\)\.catch\(\(\) => caches\.match\("\/pwa\/offline\.html"\)\)\);/);
  const precache = sw.slice(sw.indexOf("const PRECACHE"), sw.indexOf("];", sw.indexOf("const PRECACHE")));
  assert.doesNotMatch(precache, /\/api\//);
  assert.doesNotMatch(sw, /cache\.put\(request, copy\)\s*;?\s*\}\)\s*;?\s*return response/, "API responses must not be cached");
});

test("service worker caches only static shell prefixes", () => {
  const sw = read("public/pwa-sw.js");
  assert.match(sw, /const STATIC_PREFIXES = \["\/_next\/static\/", "\/pwa\/", "\/brand-assets\/"\];/);
});

test("service worker registration is scoped to /mobile/ and requests no notification permission", () => {
  const register = read("app/mobile/PwaRegister.tsx");
  assert.match(register, /register\("\/pwa-sw\.js", \{ scope: "\/mobile\/" \}\)/);
  assert.doesNotMatch(register, /Notification\.requestPermission|pushManager/);
});

test("driver header pads for the iPhone top safe area, and nav already pads for the bottom one", () => {
  const shell = read("app/mobile/driver-shell.module.css");
  assert.match(shell, /\.topbar \{[^}]*env\(safe-area-inset-top\)/);
  assert.match(shell, /\.nav \{[^}]*env\(safe-area-inset-bottom\)/);
});

test("viewport opts into safe-area coverage on the van routes", () => {
  assert.match(read("app/mobile/[van]/page.tsx"), /viewportFit: "cover"/);
});
