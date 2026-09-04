import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function browserPath() {
  return process.env.CHROME_PATH || [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(candidate => existsSync(candidate));
}

/** Render print CSS locally when Chrome/Edge is installed. Deployments can
 * omit this and continue using the print-ready HTML fallback. */
export async function renderPdfLocally(html: string, outputPath: string) {
  const browser = browserPath();
  if (!browser) throw new Error("No local Chrome or Edge PDF renderer was found.");
  const inputPath = path.join(os.tmpdir(), `fika-allergen-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
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
  } finally { await fs.unlink(inputPath).catch(() => undefined); }
}
