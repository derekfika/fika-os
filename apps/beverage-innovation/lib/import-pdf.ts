import { spawn } from "node:child_process";
import path from "node:path";
import { MAX_RECIPE_DOCUMENT_BYTES } from "./contracts";
import { MAX_IMPORT_TEXT_LENGTH } from "./import-preview";

const MAX_PDF_PAGES = 40;
const MAX_PDF_OUTPUT_BYTES = 128 * 1024;
const PDF_TIMEOUT_MS = 8_000;
type PdfResult = { text: string } | { error: "limit" | "encrypted" | "invalid" | "unavailable" };

export function extractPdfRecipeText(bytes: Buffer): Promise<PdfResult> {
  // The subprocess runs only in the source checkout's local development
  // server. Document endpoints deny production builds before reading files.
  const script = path.join(process.cwd(), "lib", "pdf-extract.mjs");
  const child = spawn(process.execPath, [
    "--max-old-space-size=96", script, String(MAX_RECIPE_DOCUMENT_BYTES),
    String(MAX_IMPORT_TEXT_LENGTH), String(MAX_PDF_PAGES),
  ], {
    env: { NODE_ENV: "production", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  });
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let length = 0;
    let error: PdfResult | undefined;
    const stop = (result: PdfResult) => {
      error ??= result;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop({ error: "limit" }), PDF_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_PDF_OUTPUT_BYTES) stop({ error: "limit" });
      else chunks.push(chunk);
    });
    child.once("error", () => { error ??= { error: "unavailable" }; });
    child.stdin.on("error", () => { /* Close determines the result after a cancelled or rejected parse. */ });
    child.once("close", code => {
      clearTimeout(timer);
      if (error || code !== 0) return resolve(error || { error: "invalid" });
      try {
        const result = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
        if (typeof result.text === "string" && result.text.length <= MAX_IMPORT_TEXT_LENGTH) return resolve({ text: result.text });
        if (result.error === "limit" || result.error === "encrypted") return resolve({ error: result.error });
      } catch { /* A worker result outside the protocol is rejected. */ }
      resolve({ error: "invalid" });
    });
    child.stdin.end(bytes);
  });
}
