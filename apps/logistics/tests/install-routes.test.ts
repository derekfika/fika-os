import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { config, middleware } from "../middleware";

// Chrome fetches the install manifest and icons WITHOUT a session. Anything that redirects them to sign-in makes the app uninstallable
// on a fresh browser (Install is disabled). These tests pin the install routes that must stay public, for both vans.
const root = path.resolve(process.cwd());
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const manifest = (van: 1 | 2) => JSON.parse(read(`public/pwa/manifest-van${van}.webmanifest`)) as {
  id: string; name: string; short_name: string; scope: string; start_url: string; display: string; icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string) {
  const bytes = readFileSync(path.join(root, "public", file));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const van of [1, 2] as const) {
  test(`van ${van} manifest is installable: identity, scope, start URL, display and icons`, () => {
    const data = manifest(van);
    assert.equal(data.id, `/mobile/van${van}`, "stable identity for this van's installed app");
    assert.equal(data.scope, `/mobile/van${van}`);
    assert.equal(data.start_url, `/mobile/van${van}`);
    assert.ok(data.start_url.startsWith(data.scope), "the start URL is inside the app scope");
    assert.equal(data.display, "standalone");
    assert.ok(data.name && data.short_name, "names present");
    const sizes = data.icons.map(icon => icon.sizes);
    assert.ok(sizes.includes("192x192"), "a 192px icon");
    assert.ok(sizes.includes("512x512"), "a 512px icon");
    assert.ok(data.icons.some(icon => icon.purpose === "maskable"), "a maskable icon");
    for (const icon of data.icons) {
      assert.equal(icon.type, "image/png");
      const [declared] = icon.sizes.split("x").map(Number);
      const size = pngSize(icon.src.replace(/^\/pwa\//, "pwa/"));
      assert.equal(size.width, declared, `${icon.src} really is ${declared}px wide`);
      assert.equal(size.height, declared, `${icon.src} really is ${declared}px tall`);
    }
  });
}

test("the two installed apps have distinct identities, so Van 1 and Van 2 never install over each other", () => {
  const [one, two] = [manifest(1), manifest(2)];
  assert.notEqual(one.id, two.id);
  assert.notEqual(one.scope, two.scope);
  assert.notEqual(one.name, two.name);
  assert.notEqual(one.short_name, two.short_name);
  assert.notEqual(one.icons[0].src, two.icons[0].src);
});

test("each van page links its own manifest in the served HTML", () => {
  const source = read("app/mobile/[van]/page.tsx");
  assert.match(source, /manifest: `\/pwa\/manifest-van\$\{number\}\.webmanifest`/);
  assert.match(source, /icons: \{ apple: `\/pwa\/van\$\{number\}-apple-touch-180\.png` \}/);
});

test("the middleware matcher never gates install metadata, icons or the static /pwa folder", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);
  for (const file of ["/pwa/manifest-van1.webmanifest", "/pwa/manifest-van2.webmanifest", "/pwa/van1-192.png", "/pwa/van1-maskable-512.png", "/pwa-sw.js", "/pwa/offline.html"]) {
    assert.equal(pattern.test(file), false, `${file} is not matched by middleware`);
  }
  for (const app of ["/mobile/van1", "/mobile/van2", "/api/logistics", "/api/logistics/driver-notifications"]) {
    assert.equal(pattern.test(app), true, `${app} is still matched by middleware`);
  }
});

const inHostedRuntime = <T>(run: () => Promise<T>) => {
  const overrides: Record<string, string | undefined> = { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_ALLOWED_EMAIL_DOMAINS: "fikacatering.com", FIKA_HUB_BASE_URL: undefined };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return run().finally(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
};
const admitted = (response: Response) => response.headers.get("x-middleware-next") === "1";

test("a logged-out browser can fetch each van's install assets and open each van's page", () => inHostedRuntime(async () => {
  for (const path of ["/pwa/manifest-van1.webmanifest", "/pwa/manifest-van2.webmanifest", "/pwa/van1-192.png", "/pwa/van2-512.png", "/pwa/van1-maskable-512.png", "/pwa-sw.js", "/mobile/van1", "/mobile/van2"]) {
    const response = await middleware(new NextRequest(`https://logistics-staging.fikacatering.com${path}`));
    assert.ok(admitted(response), `${path} is admitted without a session`);
  }
}));
