import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete FIKA Impact experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FIKA Impact — One Liverpool Street<\/title>/i);
  assert.match(html, /Coffee with an impact/);
  assert.match(html, /you can see\./);
  assert.match(html, /drinks served today/);
  assert.match(html, /Coffee grounds recovered/);
  assert.match(html, /Milk waste avoided/);
  assert.match(html, /Paper cups avoided/);
  assert.match(html, /Plastic lids avoided/);
  assert.match(html, /Modelled monthly projection/);
  assert.match(html, /Live demonstration using modelled service data/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("preserves the live simulation and hidden demonstration controls", async () => {
  const [component, hook, config, css, layout] = await Promise.all([
    readFile(new URL("../app/components/FikaImpact.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useImpactSimulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/config/impactConfig.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(component, /URLSearchParams\(window\.location\.search\)\.get\("demo"\) === "1"/);
  assert.match(component, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(component, /<DemoControls/);
  assert.match(hook, /baseIntervalMs \/ speed/);
  assert.match(hook, /setPaused\(false\)/);
  assert.match(config, /groundsPerCoffeeDrinkGrams:\s*18/);
  assert.match(config, /milkAvoidedPerMilkDrinkMl:\s*20/);
  assert.match(config, /month:\s*18\.4/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@font-face/);
  assert.doesNotMatch(css, /(^|[;{]\s*)height:\s*100svh/m);
  assert.doesNotMatch(layout, /og\.png/);
});
