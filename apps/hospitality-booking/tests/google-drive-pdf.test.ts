import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveGoogleDrivePdf } from "../lib/google-menu";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});

async function setupOAuth() {
  const directory = await mkdtemp(join(tmpdir(), "fika-drive-test-"));
  await writeFile(join(directory, "client.json"), JSON.stringify({ installed: { client_id: "test", client_secret: "test" } }));
  await writeFile(join(directory, "token.json"), JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expiry_date: Date.now() + 3_600_000 }));
  process.env.FIKA_RUNTIME_MODE = "local";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.GOOGLE_OAUTH_CLIENT_FILE = join(directory, "client.json");
  process.env.GOOGLE_OAUTH_TOKEN_FILE = join(directory, "token.json");
  process.env.GOOGLE_MENU_OUTPUT_FOLDER_ID = "root-folder";
  return directory;
}

function requestBody(request: RequestInit | undefined) {
  return new Response(request?.body).text();
}

test("existing Drive PDF update omits parents while new PDF creation keeps its parent", async () => {
  const directory = await setupOAuth();
  try {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = await requestBody(init);
      calls.push({ url, method, body });
      if (url.includes("/files/root-folder?") && method === "GET") return new Response(JSON.stringify({ id: "root-folder", mimeType: "application/vnd.google-apps.folder", trashed: false }), { status: 200 });
      if (url.includes("/files?q=") && method === "GET") return new Response(JSON.stringify({ files: [{ id: "existing-file", webViewLink: "https://drive/existing" }] }), { status: 200 });
      if (url.includes("/existing-file?") && method === "PATCH") return new Response(JSON.stringify({ id: "existing-file" }), { status: 200 });
      throw new Error(`Unexpected Drive request: ${method} ${url}`);
    };
    const existing = await saveGoogleDrivePdf({ name: "matrix.pdf", pdfBase64: "cGRm", owner: { type: "app-workspace", appId: "cpu-production" } });
    assert.equal(existing.reused, true);
    const update = calls.find(call => call.method === "PATCH")!;
    assert.equal(update.body.includes('"parents"'), false);

    calls.length = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = await requestBody(init);
      calls.push({ url, method, body });
      if (url.includes("/files/root-folder?") && method === "GET") return new Response(JSON.stringify({ id: "root-folder", mimeType: "application/vnd.google-apps.folder", trashed: false }), { status: 200 });
      if (url.includes("/files?q=") && method === "GET") return new Response(JSON.stringify({ files: [] }), { status: 200 });
      if (url.includes("/upload/drive/v3/files?") && method === "POST") return new Response(JSON.stringify({ id: "new-file" }), { status: 200 });
      throw new Error(`Unexpected Drive request: ${method} ${url}`);
    };
    const created = await saveGoogleDrivePdf({ name: "new-matrix.pdf", pdfBase64: "cGRm", owner: { type: "app-workspace", appId: "cpu-production" } });
    assert.equal(created.reused, false);
    const upload = calls.find(call => call.method === "POST" && call.url.includes("/upload/"))!;
    assert.match(upload.body, /"parents"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
