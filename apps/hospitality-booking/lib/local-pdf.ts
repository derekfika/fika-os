import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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

export async function renderPdfViaService(html: string, env: NodeJS.ProcessEnv = process.env, fetcher = fetch) {
  const endpoint = env.FIKA_PDF_RENDERER_URL?.trim();
  const token = env.FIKA_PDF_RENDERER_TOKEN?.trim();
  if (!endpoint) throw new Error("PDF_RENDERER_ERROR: hosted PDF renderer URL is not configured.");
  if (!token) throw new Error("PDF_RENDERER_ERROR: hosted PDF renderer authentication is not configured.");
  try {
    const response = await fetcher(`${endpoint.replace(/\/$/, "")}/render/pdf`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fika-renderer-token": token },
      body: JSON.stringify({ html, options: { format: "A4", printBackground: true } }),
      cache: "no-store",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`renderer returned HTTP ${response.status}`);
    if (!bytes.length || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("renderer returned invalid PDF bytes");
    return bytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("PDF_RENDERER_ERROR:")) throw error;
    throw new Error(`PDF_RENDERER_ERROR: ${message}`, { cause: error });
  }
}

export async function renderPdfToBuffer(html: string) {
  if (isHostedPdfRuntime()) return renderPdfViaService(html);
  const outputPath = path.join(os.tmpdir(), `fika-quote-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await renderPdfLocally(html, outputPath);
    return fs.readFile(outputPath);
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}
