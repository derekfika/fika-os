import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { isHostedPdfRuntime, renderPdfToBuffer, renderPdfViaService } from "../app/lib/local-pdf";

test("local CPU PDF bytes finish reading before the temporary file is removed", async t => {
  const env = process.env;
  process.env = { ...env, FIKA_RUNTIME_MODE: "local", CHROME_PATH: "fixture-renderer" };
  t.after(() => { process.env = env; });

  const pdf = Buffer.from("%PDF-1.7\nCPU matrix\n%%EOF");
  let outputPath = "";
  t.mock.method(childProcess, "spawn", (_browser: string, args: string[]) => {
    const option = args.find(arg => arg.startsWith("--print-to-pdf="));
    assert.ok(option);
    outputPath = option.slice("--print-to-pdf=".length);
    const child = new EventEmitter();
    void fs.writeFile(outputPath, pdf).then(() => child.emit("exit", 0), error => child.emit("error", error));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const unlink = t.mock.method(fs, "unlink");
  const wasRemoved = () => unlink.mock.calls.some(call => call.arguments[0] === outputPath);
  const readFile = fs.readFile;
  t.mock.method(fs, "readFile", async (file: string) => {
    await Promise.resolve();
    assert.equal(wasRemoved(), false, "cleanup started before the PDF read completed");
    return readFile(file);
  });

  assert.deepEqual(await renderPdfToBuffer("<p>CPU matrix</p>"), pdf);
  assert.equal(wasRemoved(), true);
  await assert.rejects(fs.stat(outputPath), { code: "ENOENT" });
});

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
