import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";

const css = await readFile(new URL("../../app/ui/RunSheetPrintDialog.module.css", import.meta.url), "utf8");

async function fixture(page: Page) {
  await page.setContent(`<!doctype html><html><head><style>
    :root { --fika-border-default:#ccc; --fika-surface-card:#fff; --fika-text-primary:#222; --fika-action-secondary:#333; --fika-font-display:Arial; --fika-text-secondary:#555; --fika-text-muted:#666; --fika-surface-subtle:#eee; --fika-action-primary:#315; --shadow-sm:0 1px 2px #0002; --fika-status-success-surface:#dfd; --fika-status-success:#161; --fika-status-info-surface:#def; --fika-status-danger-surface:#fdd; --fika-status-danger:#900; --fika-font-body:Arial; --fika-focus-ring:#06f; }
    body { margin:0; font:16px Arial; } .status-card { position:fixed; z-index:9999; right:0; bottom:0; width:260px; height:160px; display:grid; place-items:center; background:#f0e8d8; }
    ${css}
  </style></head><body>
    <main class="status-card" aria-label="CPU status cards">Background production status</main>
    <button id="trigger" type="button" aria-haspopup="dialog">Print run sheets</button>
    <dialog class="dialog" aria-labelledby="title">
      <header class="header"><div><h2 id="title">Build your run sheets</h2></div><button class="closeButton" aria-label="Close print run sheets">×</button></header>
      <div class="body"><div class="selectionColumn"><section class="section"><h3>Production dates</h3><fieldset class="dateChoices"><legend>Production date preset</legend><label><input id="first" type="radio" name="date" checked>Today</label><label><input type="radio" name="date">Tomorrow</label></fieldset></section><section class="section"><h3>Services</h3><label><input type="checkbox">Delivered-In</label></section><section class="section"><h3>OPLOCs</h3><label class="search"><input type="search" aria-label="Search OPLOCs and destinations"></label></section></div><aside class="summary"><div class="summaryCard"><h3>Print summary</h3><button>Print selected orders</button></div></aside></div>
      <footer class="mobileFooter"><button class="cancelButton">Cancel</button><button>Print selected orders</button></footer>
    </dialog>
    <script>const d=document.querySelector('dialog'), t=document.querySelector('#trigger'); t.addEventListener('click',()=>{d.showModal();document.querySelector('#first').focus()}); d.querySelector('.closeButton').addEventListener('click',()=>d.close()); d.addEventListener('close',()=>t.focus()); window.backdropHits=0; d.addEventListener('click',e=>{if(e.target===d && (e.clientX<d.getBoundingClientRect().left || e.clientX>d.getBoundingClientRect().right || e.clientY<d.getBoundingClientRect().top || e.clientY>d.getBoundingClientRect().bottom)) window.backdropHits++});</script>
  </body></html>`);
}

test("run-sheet dialog remains hidden until opened, then occupies the top layer responsively and restores focus", async () => {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    assert.fail(`Chromium is required for the run-sheet dialog browser regression: ${String(error)}`);
  }
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await fixture(page);
      const dialog = page.getByRole("dialog", { name: "Build your run sheets" });
      const trigger = page.getByRole("button", { name: "Print run sheets" });

      assert.equal(await dialog.isVisible(), false, "closed native dialog must not render over the status cards");
      await trigger.click();
      await assert.doesNotReject(() => dialog.waitFor({ state: "visible" }));
      assert.equal(await page.evaluate(() => document.activeElement?.id), "first", "initial focus must land on the first date control");
      assert.equal(await dialog.evaluate((node) => (node as HTMLDialogElement).matches(":modal")), true, "opened dialog must be in the browser top layer");
      const bounds = await dialog.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, `dialog must fit viewport ${viewport.width}x${viewport.height}`);
      assert.ok(await page.getByRole("checkbox").isVisible());
      assert.ok(await page.getByRole("searchbox", { name: "Search OPLOCs and destinations" }).isVisible());
      const backdrop = await dialog.evaluate((node) => getComputedStyle(node, "::backdrop").backgroundColor);
      assert.notEqual(backdrop, "rgba(0, 0, 0, 0)", "backdrop must obscure background content");
      await page.mouse.click(viewport.width - 4, viewport.height - 4);
      assert.equal(await page.evaluate(() => (window as unknown as { backdropHits: number }).backdropHits), 1, "background click must be intercepted by the modal backdrop");

      if (viewport.width <= 600) {
        assert.ok(await page.getByRole("contentinfo").isVisible().catch(() => false) || await page.locator("dialog footer").isVisible(), "narrow layout must retain the mobile action footer");
      }

      await page.keyboard.press("Escape");
      await assert.doesNotReject(() => dialog.waitFor({ state: "hidden" }));
      assert.equal(await page.evaluate(() => document.activeElement?.id), "trigger", "Escape must restore focus to the trigger");
      await trigger.click();
      await page.getByRole("button", { name: "Close print run sheets" }).click();
      await assert.doesNotReject(() => dialog.waitFor({ state: "hidden" }));
      assert.equal(await page.evaluate(() => document.activeElement?.id), "trigger", "Close must restore focus to the trigger");
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
