export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const isAllowedResource = url => ["about:", "blob:", "data:", "file:"].some(protocol => url.startsWith(protocol));

export async function renderPdf(html, options = {}) {
  if (typeof html !== "string" || !html.trim()) throw new Error("html is required");
  if (html.length > MAX_BODY_BYTES) throw new Error("html exceeds the request limit");
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"], headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", request => isAllowedResource(request.url()) ? request.continue() : request.abort());
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(async () => { await document.fonts?.ready; });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: options.printBackground !== false, preferCSSPageSize: true }));
  } finally {
    await browser.close();
  }
}
