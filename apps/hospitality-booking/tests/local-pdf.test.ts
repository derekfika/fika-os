import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isHostedPdfRuntime, renderPdfToBufferWithRuntime, renderPdfWithBrowser } from "../lib/local-pdf";

function withRuntimeEnv(values: Record<string, string | undefined>, action: () => void) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { action(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("hosted PDF selection does not depend on Windows browser paths", () => {
  withRuntimeEnv({ FIKA_RUNTIME_MODE: "staging", K_SERVICE: undefined, K_REVISION: undefined }, () => assert.equal(isHostedPdfRuntime(process.env, "win32"), true));
});

test("local mode remains distinct from hosted mode", () => {
  withRuntimeEnv({ FIKA_RUNTIME_MODE: "local", K_SERVICE: "hosted-service", K_REVISION: "hosted-revision" }, () => assert.equal(isHostedPdfRuntime(process.env, "win32"), false));
});

test("Cloud Run K_SERVICE selects the hosted renderer", () => {
  assert.equal(isHostedPdfRuntime({ K_SERVICE: "fika-hospitality-staging", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv, "linux"), true);
});

test("production mode selects the hosted renderer", () => {
  assert.equal(isHostedPdfRuntime({ FIKA_RUNTIME_MODE: "production" } as unknown as NodeJS.ProcessEnv, "win32"), true);
});

test("hosted Chromium failure does not fall back to Windows Chrome", async () => {
  let localCalled = false;
  await assert.rejects(
    renderPdfToBufferWithRuntime("<p>Quote</p>", {
      hosted: async () => { throw new Error("HOSTED_CHROMIUM_ERROR: launch failed"); },
      local: async () => { localCalled = true; return Buffer.from("%PDF-"); },
    }, { K_SERVICE: "hosted-service" } as unknown as NodeJS.ProcessEnv),
    /HOSTED_CHROMIUM_ERROR/,
  );
  assert.equal(localCalled, false);
});

test("hosted browser path returns nonempty PDF bytes", async () => {
  const pdf = await renderPdfWithBrowser("<html><body>Quote</body></html>", async () => ({
    async newPage() {
      return {
        async setContent() {},
        async evaluate() {},
        async pdf() { return new TextEncoder().encode("%PDF-1.7\nquote"); },
      };
    },
    async close() {},
  }));
  assert.ok(pdf.length > 0);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("quote Drive route renders bytes before upload and does not write a local PDF cycle", async () => {
  const source = await readFile(new URL("../app/api/quotes/drive/route.ts", import.meta.url), "utf8");
  assert.match(source, /renderPdfToBuffer/);
  assert.match(source, /toString\("base64"\)/);
  assert.doesNotMatch(source, /renderPdfLocally|writeFile|readFile|unlink/);
  assert.doesNotMatch(source, /No local Chrome or Edge PDF renderer was found/);
});
