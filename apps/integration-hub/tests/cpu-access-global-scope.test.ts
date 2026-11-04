import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";

// Run the actual HTTP route with isolated admission/scope/package dependencies.
function route(options: { all?: boolean; ids?: string[]; failure?: "session" | "app" | "store" | "scope" | "package" } = {}) {
  const calls: string[] = [];
  const fail = (status: number) => { throw Object.assign(new Error("Synthetic access rejected"), { status }); };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/api": { errorResponse: (error: { status?: number }) => NextResponse.json({ error: "rejected" }, { status: error.status || 500 }) },
    "@/lib/authmod-core": { FirestoreAuthModRepository: class {} },
    "@/lib/authmod-core/evaluator": {
      createAuthModEvaluationContext: () => ({}),
      resolveUserAccess: async (_repository: unknown, input: { appId: string }) => {
        calls.push("app"); assert.equal(input.appId, "cpu-production");
        return { allowed: options.failure !== "app" && options.failure !== "store", reasonCode: options.failure === "store" ? "store-unavailable" : "denied" };
      },
    },
    "@/lib/fika-session": { requireFikaSession: async () => {
      calls.push("session"); if (options.failure === "session") fail(401);
      return { authmodIdentityId: "identity:synthetic", displayName: "Synthetic operator", email: "synthetic@example.invalid", identityKind: "person", fullAccess: true, role: "integration-admin" };
    } },
    "@/lib/oploc-authorization": { resolvePermittedOplocIds: async (input: { appId: string }) => {
      calls.push("scope"); assert.equal(input.appId, "cpu-production"); if (options.failure === "scope") fail(503);
      return { all: options.all ?? false, ids: new Set(options.ids || []) };
    } },
    "@/lib/oploc-read-package": {
      getOplocReadPackage: async () => { calls.push("package"); return { value: { oplocs: [{ canonicalId: "oploc:a", label: "Same label" }, { canonicalId: "oploc:b", label: "Same label" }] } }; },
      validateOplocReadPackage: (value: unknown) => { if (options.failure === "package") fail(503); return value; },
    },
    "@fika/server-shared/data-source-meter-server": { withDataTrace: (_metadata: unknown, action: () => Promise<NextResponse>) => action() },
  };
  const source = readFileSync(new URL("../app/api/cpu-production/access/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: NextRequest) => Promise<NextResponse> } = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return { GET: exports.GET!, calls };
}

const request = () => new NextRequest("https://synthetic.invalid/api/cpu-production/access?allOplocs=true", { headers: { "x-role": "integration-admin" } });

test("CPU access exposes only the trusted global scope while preserving canonical site filtering", async () => {
  for (const [all, ids, expectedIds] of [
    [true, [], ["oploc:a", "oploc:b"]],
    [false, ["oploc:a"], ["oploc:a"]],
    [false, ["oploc:a", "oploc:b"], ["oploc:a", "oploc:b"]],
    [false, [], []],
  ] as Array<[boolean, string[], string[]]>) {
    const { GET, calls } = route({ all, ids });
    const response = await GET(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.allOplocs, all);
    assert.deepEqual(body.oplocs.map((oploc: { id: string }) => oploc.id), expectedIds);
    assert.ok(body.oplocs.every((oploc: { active: boolean }) => oploc.active));
    assert.equal(body.principal.id, "identity:synthetic");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(calls, ["session", "app", "scope", "package"]);
  }
});

test("CPU access never exposes global scope when authentication, admission or scope/package authority fails", async () => {
  for (const [failure, status] of [["session", 401], ["app", 403], ["store", 503], ["scope", 503], ["package", 503]] as const) {
    const { GET, calls } = route({ all: true, failure });
    const response = await GET(request());
    assert.equal(response.status, status, failure);
    const body = await response.json();
    assert.equal(body.allOplocs, undefined);
    assert.equal(body.oplocs, undefined);
    if (["session", "app", "store"].includes(failure)) assert.ok(!calls.includes("package"));
  }
});
