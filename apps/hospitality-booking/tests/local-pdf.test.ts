import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isHostedPdfRuntime, renderPdfWithBrowser } from "../lib/local-pdf";

test("hosted PDF selection does not depend on Windows browser paths", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_RUNTIME_MODE = "staging";
  try {
    assert.equal(isHostedPdfRuntime(), true);
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = previous;
  }
});

test("local mode remains distinct from hosted mode", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_RUNTIME_MODE = "local";
  try {
    assert.equal(isHostedPdfRuntime(), false);
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = previous;
  }
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
});
