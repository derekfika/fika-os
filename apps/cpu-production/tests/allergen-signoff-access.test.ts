import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { MasterSignCommand } from "../lib/production-plan-command-schema";
import { requireCpuActor } from "../lib/cpu-access-client";

const appRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const png = "data:image/png;base64,iVBORw0KGgo=";

function sourceFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "tests"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out); else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

test("CPU allergen sign-off depends on no AUTHMOD allergen authority", () => {
  const offenders = sourceFiles(appRoot).filter((file) => /production\.allergen-(sign|final-approve)/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("each signature role needs a printed name and a drawn (PNG) signature", () => {
  const { role, printedName, signatureDataUrl, attestation } = MasterSignCommand.shape;
  assert.deepEqual([...role.options], ["production_chef", "head_chef_site_manager"], "exactly the two defined signature roles");
  for (const valid of ["production_chef", "head_chef_site_manager"]) assert.equal(role.safeParse(valid).success, true);
  assert.equal(role.safeParse("site_owner").success, false);
  for (const invalid of ["", "A", "   ", undefined]) assert.equal(printedName.safeParse(invalid).success, false, JSON.stringify(invalid));
  assert.equal(printedName.safeParse(" Casey Chef ").success, true);
  for (const invalid of ["", undefined, "data:text/html;base64,PHNjcmlwdD4=", "https://example.test/signature.png"]) assert.equal(signatureDataUrl.safeParse(invalid).success, false, JSON.stringify(invalid));
  assert.equal(signatureDataUrl.safeParse(png).success, true);
  assert.equal(attestation.safeParse("short").success, false, "the attestation text is still required");
});

test("the single-order sign route keeps the same name, signature and role requirements", () => {
  const route = readFileSync(join(appRoot, "app/api/production-plan/route.ts"), "utf8");
  assert.match(route, /action: z\.literal\("sign-matrix"\)|z\.literal\("sign-matrix"\)/);
  assert.match(route, /role: z\.enum\(\["production_chef", "head_chef_site_manager"\]\), printedName: z\.string\(\)\.trim\(\)\.min\(2\)/);
  assert.match(route, /signatureDataUrl: z\.string\(\)\.regex\(\/\^data:image\\\/png;base64,\/\)/);
});

test("signing still needs an authenticated CPU actor from the Hub: anonymous or non-admitted callers are refused", async () => {
  const saved = { fetch: globalThis.fetch, mode: process.env.FIKA_RUNTIME_MODE, hub: process.env.FIKA_HUB_BASE_URL };
  process.env.FIKA_RUNTIME_MODE = "local"; process.env.FIKA_HUB_BASE_URL = "http://localhost:3200";
  const request = new NextRequest("https://cpu.test/api/production-plan", { method: "POST", headers: { cookie: "fika_os_session=test" } });
  try {
    globalThis.fetch = (async () => Response.json({ error: { message: "Authentication is required." } }, { status: 401 })) as typeof fetch;
    await assert.rejects(requireCpuActor(request), (error: Error & { status?: number }) => error.status === 401);
    globalThis.fetch = (async () => Response.json({ error: { message: "Your account does not currently have CPU Production access." } }, { status: 403 })) as typeof fetch;
    await assert.rejects(requireCpuActor(request), (error: Error & { status?: number }) => error.status === 403);
    globalThis.fetch = (async () => Response.json({ principal: { id: "authid:chef", displayName: "Tablet Chef" } })) as typeof fetch;
    assert.deepEqual(await requireCpuActor(request), { uid: "authid:chef", name: "Tablet Chef", role: "cpu-production" });
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = saved.mode;
    if (saved.hub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = saved.hub;
  }
});

test("signature evidence keeps timestamp, actor, scope and the frozen matrix lineage", () => {
  const route = readFileSync(join(appRoot, "app/api/production-plan/route.ts"), "utf8");
  assert.match(route, /const signature: InternalMatrixSignature = \{ role: command\.role, printedName: command\.printedName, signedAt: timestamp, actor: auditActor, attestation: command\.attestation, signatureDataUrl: command\.signatureDataUrl, scope: currentScope \}/);
  assert.match(route, /allergen-release-revoked/);
});
