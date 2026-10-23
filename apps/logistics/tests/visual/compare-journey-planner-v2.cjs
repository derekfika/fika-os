// Builds a side-by-side (reference | React render) image per captured size for visual review.
const { chromium } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const dir = process.env.SHOT_DIR || path.join(__dirname, "..", "..", "test-results", "jp-v2");
const reference = process.env.REFERENCE_IMAGE;
if (!reference || !fs.existsSync(reference)) { console.error("Set REFERENCE_IMAGE to the approved design reference file."); process.exit(1); }
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
(async () => {
  const browser = await chromium.launch();
  const pairs = [["full-1536", 1536], ["full-1920", 1920]];
  for (const [name, width] of pairs) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const ref = dataUri(reference, reference.endsWith(".webp") ? "image/webp" : "image/png");
    const render = dataUri(path.join(dir, `${name}.png`), "image/png");
    await page.setContent(`<body style="margin:0;background:#222;font:600 14px sans-serif;color:#fff"><div style="display:flex;gap:12px;padding:12px"><figure style="margin:0;flex:1"><figcaption style="padding:4px 0">Approved reference</figcaption><img style="width:100%" src="${ref}"></figure><figure style="margin:0;flex:1"><figcaption style="padding:4px 0">React render (${name})</figcaption><img style="width:100%" src="${render}"></figure></div></body>`);
    await page.waitForTimeout(300);
    const height = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewportSize({ width: 1600, height });
    await page.screenshot({ path: path.join(dir, `compare-${name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log("comparisons written to", dir);
})();
