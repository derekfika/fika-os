import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";

// Execute the actual HTTP handler with isolated authority/read packages. No Firebase writes.
function handler(options: { role?: string; all?: boolean; failure?: "session" | "permission" | "scope" | "package" } = {}) {
  const denied = () => { throw Object.assign(new Error("Denied"), { status: 403 }); };
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/auth": { actorFromSession: async () => ({ role: options.role || "integration-admin" }) },
    "@/lib/authmod": { assertPermission: () => { if (options.failure === "permission") denied(); } },
    "@/lib/authmod-core": { FirestoreAuthModRepository: class {} },
    "@/lib/fika-session": { requireFikaSession: async () => { if (options.failure === "session") denied(); return { email: "synthetic@example.invalid", authmodIdentityId: "synthetic" }; } },
    "@/lib/oploc-authorization": { resolvePermittedOplocIds: async () => { if (options.failure === "scope") denied(); return { all: options.all ?? true, ids: new Set(["oploc:allowed"]) }; } },
    "@/lib/oploc-read-package": {
      getOplocReadPackage: async () => ({ value: { oplocs: ["allowed", "other", "disabled"].map(id => ({ canonicalId: `oploc:${id}`, label: id })) } }),
      validateOplocReadPackage: (value: unknown) => { if (options.failure === "package") denied(); return value; },
    },
    "@/lib/service-arrangements-read-package": {
      getServiceArrangementsReadPackage: async () => ({ value: {
        serviceDefinitions: [{ canonicalId: "di", label: "Delivered-In" }, { canonicalId: "gg", label: "Grab & Go" }],
        arrangements: ["allowed", "other"].flatMap(id => ["di", "gg"].map(serviceDefinitionId => ({ oplocId: `oploc:${id}`, serviceDefinitionId, lifecycleState: "active", effectiveFrom: "2000-01-01" }))),
      } }),
      validateServiceArrangementsReadPackage: (value: unknown) => value,
    },
    "@fika/server-shared/delivered-in-access": { DELIVERED_IN_PERMISSIONS: ["delivered_in.view"] },
    "../../../../../../shared/admission": { admissionFailure: (_app: string, status: number) => ({ status }), admissionJson: () => ({ error: "denied" }) },
  };
  const source = readFileSync(new URL("../app/api/delivered-in/access/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: NextRequest) => Promise<NextResponse> } = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return exports.GET!;
}

test("one-off capability requires authenticated integration admin, global scope, and Delivered-In service", async () => {
  for (const role of ["integration-admin", "viewer", "reviewer"]) {
    for (const all of [true, false]) {
      for (const service of ["delivered-in", "grab-and-go"]) {
        const response = await handler({ role, all })(new NextRequest(`https://synthetic.invalid/api/delivered-in/access?service=${service}`));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.access.canViewOneOffDestinations, role === "integration-admin" && all && service === "delivered-in", `${role}/${all}/${service}`);
        assert.deepEqual(result.access.oplocIds, all ? ["oploc:allowed", "oploc:other"] : ["oploc:allowed"]);
        assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      }
    }
  }
});

test("authority or package failure never returns the one-off capability", async () => {
  for (const failure of ["session", "permission", "scope", "package"] as const) {
    const response = await handler({ failure })(new NextRequest("https://synthetic.invalid/api/delivered-in/access"));
    assert.equal(response.status, 403, failure);
    assert.equal((await response.json()).access, undefined);
  }
});
