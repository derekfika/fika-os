import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { addSchedulableMinutes, resolveNextAvailableScheduleStart } from "../lib/scheduling";

// Execute the small pure decisions from their production files without loading
// the API route's Firebase state or the interactive React tree.
function sourceFunction(path: string, name: string, bindings: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `${name} must remain a named production function`);
  const compiled = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(bindings), `${compiled}\nreturn ${name};`)(...Object.values(bindings)) as (...args: any[]) => any;
}

const mobilePath = "../app/mobile/MobileWorkflow.tsx";
const routePath = "../app/api/logistics/route.ts";
const stopNavigationAddress = sourceFunction(mobilePath, "stopNavigationAddress");
const sameStopEndpoint = sourceFunction(routePath, "sameStopEndpoint");
const resolveStopPlannedTiming = sourceFunction(routePath, "resolveStopPlannedTiming", {
  sameStopEndpoint,
  resolveNextAvailableScheduleStart,
  addSchedulableMinutes,
  HttpError: class HttpError extends Error {},
});

test("driver map uses a one-off address snapshot instead of its display label", () => {
  const stop = { locationOplocId: "", oneOffEndpointId: "day:one-off:1", locationLabelSnapshot: "Client event venue", locationAddressSnapshot: "24 Example Street, London" };
  assert.equal(stopNavigationAddress(stop), "24 Example Street, London");
  assert.equal(stopNavigationAddress({ locationOplocId: "oploc:1", locationLabelSnapshot: "Site" }, { address: "1 Governed Road", label: "Site" }), "1 Governed Road");
  assert.equal(stopNavigationAddress({ locationOplocId: "oploc:1", locationLabelSnapshot: "Site" }, { label: "Site" }), "Site");
});

test("endpoint identity separates distinct one-offs and preserves governed matching", () => {
  const first = { locationOplocId: "", oneOffEndpointId: "day:one-off:1" };
  const second = { locationOplocId: "", oneOffEndpointId: "day:one-off:2" };
  assert.equal(sameStopEndpoint(first, second), false);
  assert.equal(sameStopEndpoint(first, { ...first }), true);
  assert.equal(sameStopEndpoint({ locationOplocId: "oploc:1" }, { locationOplocId: "oploc:1" }), true);
  assert.equal(sameStopEndpoint({ locationOplocId: "oploc:1" }, { locationOplocId: "oploc:2" }), false);
  assert.equal(sameStopEndpoint({ locationOplocId: "day:one-off:1" }, first), false);
});

test("timing moves a different one-off visit but retains a same-destination visit", () => {
  const first = { canonicalId: "stop:1", status: "planned", locationOplocId: "", oneOffEndpointId: "day:one-off:1" };
  const different = { canonicalId: "stop:2", status: "planned", locationOplocId: "", oneOffEndpointId: "day:one-off:2", plannedWindow: { startTime: "09:00", endTime: "09:30" } };
  const same = { ...different, oneOffEndpointId: first.oneOffEndpointId };
  assert.deepEqual(resolveStopPlannedTiming(first, { plannedWindow: { startTime: "09:00", endTime: "09:30" } }, [different]), { plannedWindow: { startTime: "09:30", endTime: "10:00" } });
  assert.deepEqual(resolveStopPlannedTiming(first, { plannedWindow: { startTime: "09:00", endTime: "09:30" } }, [same]), { plannedWindow: { startTime: "09:00", endTime: "09:30" } });
});
