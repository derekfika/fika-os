import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

type PrintTarget = { closed: boolean; writes: number; prints: number };
declare global {
  interface Window {
    printTargets: PrintTarget[];
    completedReads: number;
  }
}

const orders = [{
  canonicalId: "test-order", version: 1, status: "planned", serviceDate: "2026-11-23",
  origin: "menu_planning", productionCategory: "delivered_in", sourceEntityId: "test-day",
  sourcePublicationDayId: "test-publication-day", sourceVersion: 1, sourceContentHash: "a".repeat(64),
  lines: [{ canonicalId: "test-line", itemName: "Test soup", sortOrder: 1, workstream: "delivered_in" }],
}];

async function dialogBundle() {
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx", contents: `
      import { createRoot } from "react-dom/client";
      import { GastroLabelPrintDialog } from "./app/ui/GastroLabelPrintDialog";
      const root = createRoot(document.getElementById("root"));
      let mount = 0;
      const render = () => root.render(
        <GastroLabelPrintDialog key={++mount} productionDate="2026-11-23" selectedSiteIds={[]} />
      );
      render();
      window.addEventListener("fixture-remount", render);` },
    bundle: true, write: false, jsx: "automatic", outdir: "fixture", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "deferred-production-day", setup(builder) {
      builder.onResolve({ filter: /^\.\/whole-day-production$/ }, () => ({ path: "day", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        export async function loadWholeDay() {
          try { return await window.readFixtureDay(); }
          finally { window.completedReads++; }
        }` }));
    } }],
  });
  return result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
}

async function beginPrint(page: Page) {
  await page.getByRole("button", { name: "Print Gastro Labels" }).click();
  await page.getByRole("spinbutton", { name: "Number of Test soup labels" }).fill("1");
  await page.getByRole("button", { name: "Preview PDF and print" }).click();
}

test("closing Gastro Labels invalidates only the pending print attempt", async t => {
  const script = await dialogBundle();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const dismissal of ["Cancel", "Escape", "Unmount"] as const) {
    await t.test(dismissal, async t => {
      const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
      t.after(() => page.close());
      const oldRead = Promise.withResolvers<void>();
      const newRead = Promise.withResolvers<void>();
      t.after(() => { oldRead.resolve(); newRead.resolve(); });
      let readCount = 0;
      await page.route("**/*", route => route.abort());
      await page.exposeFunction("readFixtureDay", async () => {
        const read = ++readCount;
        if (read === 2) {
          await oldRead.promise;
          if (dismissal === "Escape") throw new Error("Expired fixture read");
        }
        if (read === 4) await newRead.promise;
        return orders;
      });
      await page.setContent('<div id="root"></div>');
      await page.evaluate(() => {
        window.completedReads = 0;
        window.printTargets = [];
        window.open = () => {
          const target = { closed: false, writes: 0, prints: 0 };
          window.printTargets.push(target);
          return {
            get closed() { return target.closed; },
            document: { body: {}, open() {}, write() { target.writes++; }, close() {} },
            focus() {}, print() { target.prints++; }, close() { target.closed = true; },
          } as unknown as Window;
        };
      });
      await page.addScriptTag({ content: script });
      await beginPrint(page);
      if (dismissal === "Escape") await page.keyboard.press("Escape");
      else if (dismissal === "Unmount") await page.evaluate(() => window.dispatchEvent(new Event("fixture-remount")));
      else await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector("dialog")?.open);
      assert.deepEqual(await page.evaluate(() => window.printTargets), [{ closed: true, writes: 0, prints: 0 }]);

      await beginPrint(page);
      oldRead.resolve();
      await page.waitForFunction(() => window.completedReads === 3);
      assert.equal(await page.getByRole("button", { name: "Checking production…" }).isDisabled(), true);
      assert.equal(await page.getByRole("alert").count(), 0);
      newRead.resolve();
      await page.waitForFunction(() => window.printTargets[1]?.prints === 1);
      assert.deepEqual(await page.evaluate(() => window.printTargets), [
        { closed: true, writes: 0, prints: 0 }, { closed: false, writes: 1, prints: 1 },
      ]);
    });
  }
});
