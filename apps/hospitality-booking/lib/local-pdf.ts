import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

function browserPath() {
  return process.env.CHROME_PATH || [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find(candidate => existsSync(candidate));
}

export function isHostedPdfRuntime(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  const mode = env.FIKA_RUNTIME_MODE?.trim().toLowerCase();
  if (mode === "local") return false;
  if (mode === "staging" || mode === "production") return true;
  // K_SERVICE is set by Cloud Run, including Firebase App Hosting services.
  // The Linux production guard also prevents a misconfigured hosted service
  // from attempting Windows browser discovery.
  return Boolean(env.K_SERVICE || env.K_REVISION || (platform === "linux" && env.NODE_ENV === "production"));
}

export async function renderPdfLocally(html: string, outputPath: string) {
  const browser = browserPath();
  if (!browser) throw new Error("No local Chrome or Edge PDF renderer was found.");
  const inputPath = path.join(os.tmpdir(), `fika-quote-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fs.writeFile(inputPath, html, "utf8");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files", `--print-to-pdf=${outputPath}`, `file:///${inputPath.replaceAll("\\", "/")}`], { windowsHide: true });
      let stderr = "";
      child.stderr?.on("data", chunk => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Local PDF renderer exited with code ${code}: ${stderr.trim()}`)));
    });
    const stat = await fs.stat(outputPath);
    if (!stat.size) throw new Error("Local PDF renderer produced an empty file.");
  } finally {
    await fs.unlink(inputPath).catch(() => undefined);
  }
}

type PdfBrowser = { newPage(): Promise<{ setContent(html: string, options?: { waitUntil: "networkidle0" }): Promise<void>; evaluate(callback: () => Promise<void>): Promise<void>; pdf(options: { format: "A4"; printBackground: boolean; preferCSSPageSize: boolean }): Promise<Uint8Array> }>; close(): Promise<void> };

export async function renderPdfWithBrowser(html: string, launch: () => Promise<PdfBrowser>) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(async () => { await document.fonts?.ready; });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const bytes = Buffer.from(pdf);
    if (!bytes.length || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Hosted PDF renderer produced invalid PDF bytes.");
    return bytes;
  } finally {
    await browser.close();
  }
}

async function renderPdfHosted(html: string) {
  try {
    const executablePath = await chromium.executablePath();
    return await renderPdfWithBrowser(html, () => puppeteer.launch({ args: chromium.args, executablePath, headless: true }) as unknown as Promise<PdfBrowser>);
  } catch (error) {
    throw new Error(`HOSTED_CHROMIUM_ERROR: ${(error as Error).message}`, { cause: error });
  }
}

export async function renderPdfToBufferWithRuntime(
  html: string,
  runtimes: { hosted: (value: string) => Promise<Buffer>; local: (value: string) => Promise<Buffer> },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (isHostedPdfRuntime(env)) return runtimes.hosted(html);
  return runtimes.local(html);
}

export async function renderPdfToBuffer(html: string) {
  if (isHostedPdfRuntime()) return renderPdfHosted(html);
  const outputPath = path.join(os.tmpdir(), `fika-quote-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await renderPdfLocally(html, outputPath);
    return fs.readFile(outputPath);
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}
