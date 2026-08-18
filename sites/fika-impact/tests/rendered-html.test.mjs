import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const outputRoot = new URL("../out/", import.meta.url);
const deploymentPath = "/tools/impact-tracker";

test("exports the opening presentation as static production HTML", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  assert.match(html, /<title>FIKA Impact — One Liverpool Street<\/title>/i);
  assert.match(html, /Coffee creates/);
  assert.match(html, /measurable<br\/>impact\./);
  assert.match(html, /Coffees served today: 50/);
  assert.match(html, /One Liverpool Street/);
  assert.match(html, /src="\.\/one-liverpool-street\.png"/);
  assert.match(html, /src="\.\/fika-logo-white\.png"/);
  assert.match(html, new RegExp(`${deploymentPath}/_next/static/`));
  assert.match(html, /aria-label="View 1 of 5"/);
  assert.match(html, /Live data/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!tools\/impact-tracker)/);

  const referencedAssets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const reference of referencedAssets) {
    if (reference.startsWith(deploymentPath)) {
      await access(new URL(reference.slice(deploymentPath.length + 1), outputRoot));
    } else if (reference.startsWith("./")) {
      await access(new URL(reference.slice(2), outputRoot));
    }
  }
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
  assert.match(views, /Modelled projection/);
  assert.match(views, /Massive/);
  assert.match(views, /Purpose,/);
});

test("preserves simulation, controls, motion safety, and static deployment configuration", async () => {
  const [presentation, controls, hook, config, css, nextConfig] = await Promise.all([
    readFile(new URL("../app/components/ImpactPresentation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DemoControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useImpactSimulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/config/impactConfig.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
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
  assert.match(hook, /STATIC_OPENING_DRINKS = 50/);
  assert.match(hook, /setTotals\(totalsForDrinks\(randomOpeningDrinks\(\)\)\)/);
  assert.match(hook, /randomInteger\(interval\.min, interval\.max\) \/ speed/);
  assert.match(hook, /length: increment/);
  assert.match(hook, /if \(roll <= 45\) return 1/);
  assert.match(hook, /if \(roll <= 95\) return 4/);
  assert.match(hook, /return 5/);
  assert.match(hook, /setPaused\(false\)/);
  assert.match(config, /groundsPerCoffeeDrinkGrams:\s*18/);
  assert.match(config, /milkAvoidedPerMilkDrinkMl:\s*20/);
  assert.match(config, /month:\s*18\.4/);
  assert.match(config, /openingDrinks:\s*\{ min: 30, max: 70 \}/);
  assert.match(config, /increment:\s*\{ min: 1, max: 5 \}/);
  assert.match(config, /intervalMs:\s*\{ min: 1_500, max: 5_000 \}/);
  assert.match(css, /height:\s*100svh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /--ink-deep:\s*#280f8c/);
  assert.match(css, /\.presentation-brand > span \{ color: var\(--mint\)/);
  assert.match(css, /\.brand-headline[^}]*letter-spacing:\s*-\.035em/);
  assert.match(presentation, /useReducedMotion/);
  assert.match(nextConfig, /output:\s*"export"/);
  assert.match(nextConfig, /basePath/);
  assert.match(nextConfig, /assetPrefix/);
  assert.match(nextConfig, /trailingSlash:\s*true/);
});
