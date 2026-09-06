import assert from "node:assert/strict";
import test from "node:test";
import { isHostedPdfRuntime, renderPdfViaService } from "../app/lib/local-pdf";

test("hosted CPU PDF selection is explicit and does not depend on system browser paths", () => {
  assert.equal(isHostedPdfRuntime({ FIKA_RUNTIME_MODE: "staging" }, "win32"), true);
  assert.equal(isHostedPdfRuntime({ FIKA_RUNTIME_MODE: "local" }, "linux"), false);
});

test("hosted CPU renderer returns only real PDF bytes", async () => {
  const requests: RequestInit[] = [];
  const pdf = await renderPdfViaService("<html><body>Matrix</body></html>", { FIKA_PDF_RENDERER_URL: "https://renderer.example", FIKA_PDF_RENDERER_TOKEN: "token" }, async (_input, init) => {
    requests.push(init || {});
    return new Response(Buffer.from("%PDF-1.7\nCPU matrix"), { status: 200 });
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(requests.length, 1);
  assert.equal((requests[0].headers as Record<string, string>)["x-fika-renderer-token"], "token");
});

test("missing hosted renderer configuration fails clearly", async () => {
  await assert.rejects(() => renderPdfViaService("<html></html>", { FIKA_RUNTIME_MODE: "staging" }, fetch), /renderer URL is not configured/i);
});

test("invalid hosted renderer response fails closed", async () => {
  await assert.rejects(() => renderPdfViaService("<html></html>", { FIKA_PDF_RENDERER_URL: "https://renderer.example", FIKA_PDF_RENDERER_TOKEN: "token" }, async () => new Response("not a pdf", { status: 200 })), /invalid PDF bytes/i);
});
