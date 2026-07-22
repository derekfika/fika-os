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

test("server-renders the opening presentation view and persistent frame", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>FIKA Impact — One Liverpool Street<\/title>/i);
  assert.match(html, /Today’s coffee service is creating/);
  assert.match(html, /measurable impact\./);
  assert.match(html, /drinks served/);
  assert.match(html, /One Liverpool Street/);
  assert.match(html, /aria-label="View 1 of 5"/);
  assert.match(html, /Live demonstration/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("defines five self-contained presentation stories", async () => {
  const views = await readFile(new URL("../app/components/PresentationViews.tsx", import.meta.url), "utf8");
  assert.match(views, /LiveServiceView/);
  assert.match(views, /ImpactTodayView/);
  assert.match(views, /ImpactMethodView/);
  assert.match(views, /TangibleImpactView/);
  assert.match(views, /LivePulseView/);
  assert.match(views, /Coffee grounds recovered/);
  assert.match(views, /Milk waste avoided/);
  assert.match(views, /Paper cups avoided/);
  assert.match(views, /Plastic lids avoided/);
  assert.match(views, /Modelled monthly projection/);
});

test("preserves simulation and adds presentation controls", async () => {
  const [presentation, controls, hook, config, css] = await Promise.all([
    readFile(new URL("../app/components/ImpactPresentation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DemoControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useImpactSimulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/config/impactConfig.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(presentation, /VIEW_DURATIONS = \[12_000, 14_000, 12_000, 14_000, 12_000\]/);
  assert.match(presentation, /URLSearchParams\(window\.location\.search\)\.get\("demo"\)/);
  assert.match(presentation, /event\.key\.toLowerCase\(\) === "d"/);
  assert.match(presentation, /event\.key === "ArrowLeft"/);
  assert.match(presentation, /event\.key === "ArrowRight"/);
  assert.match(presentation, /event\.code === "Space"/);
  assert.match(presentation, /button, input, select, textarea/);
  assert.match(controls, /Previous view/);
  assert.match(controls, /Next view/);
  assert.match(controls, /Restart presentation/);
  assert.match(hook, /baseIntervalMs \/ speed/);
  assert.match(hook, /setPaused\(false\)/);
  assert.match(config, /groundsPerCoffeeDrinkGrams:\s*18/);
  assert.match(config, /milkAvoidedPerMilkDrinkMl:\s*20/);
  assert.match(config, /month:\s*18\.4/);
  assert.match(css, /height:\s*100svh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
