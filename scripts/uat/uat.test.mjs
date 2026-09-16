import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli.mjs";
import { discoverBuilds } from "./builds.mjs";
import { buildGcloudInvocation, buildLoggingFilter, escapeWindowsCmdArgument, normalizeLogRecord, readCloudLogs, runGcloud } from "./logs.mjs";
import { captureState, normalizeCpuState, normalizeDeliveredState, normalizeMenuState } from "./state.mjs";
import { evaluateInvariants } from "./invariants.mjs";
import { renderMarkdown } from "./bundle.mjs";

test("CLI accepts app and rejects invalid values", () => {
  assert.equal(parseArgs(["logs", "--app", "delivered-in"]).app, "delivered-in");
  assert.equal(parseArgs(["logs", "--tail-errors"]).tailErrors, true);
  assert.equal(parseArgs(["logs", "--app", "delivered-in", "--tail-errors"]).app, "all");
  assert.throws(() => parseArgs(["logs", "--app", "nope"]), /Invalid app/);
  assert.throws(() => parseArgs(["state", "--service-date", "2026-02-30", "--oploc", "oploc:x"]), /valid calendar date/);
  assert.throws(() => parseArgs(["logs", "--minutes", "0"]), /--minutes/);
  assert.throws(() => parseArgs(["logs", "--limit", "501"]), /--limit/);
  assert.throws(() => parseArgs(["logs", "--severity", "nope"]), /--severity/);
});

test("logging filters are bounded and target known services", () => {
  const filter = buildLoggingFilter({ app: "delivered-in", minutes: 15, serviceDate: "2026-09-14", oploc: "oploc:x", buildSha: "abc1234", requestId: "req-1", event: "evt", now: new Date("2026-09-16T10:00:00Z") });
  assert.match(filter, /resource\.type="cloud_run_revision"/);
  assert.match(filter, /fika-delivered-in-staging/);
  assert.match(filter, /jsonPayload\.serviceDate="2026-09-14"/);
  assert.match(filter, /jsonPayload\.oplocId="oploc:x"/);
  assert.match(filter, /jsonPayload\.buildSha="abc1234"/);
  assert.match(filter, /jsonPayload\.requestId="req-1"/);
  assert.match(filter, /timestamp >=/);
  assert.match(buildLoggingFilter({ app: "all", minutes: 15 }), /fika-os-staging/);
});

test("gcloud invocation stays native on non-Windows and uses ComSpec on Windows", async () => {
  const logicalArgs = ["logging", "read", 'resource.type="cloud_run_revision" AND (resource.labels.service_name="fika-delivered-in-staging") AND jsonPayload.oplocId="oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b"', "--limit=2"];
  const nonWindows = buildGcloudInvocation(logicalArgs, "linux", {});
  assert.equal(nonWindows.executable, "gcloud"); assert.deepEqual(nonWindows.args, logicalArgs);
  const windows = buildGcloudInvocation(logicalArgs, "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" });
  assert.equal(windows.executable, "C:\\Windows\\System32\\cmd.exe"); assert.deepEqual(windows.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(windows.args[3], /^gcloud\.cmd /); assert.match(windows.args[3], /\^\(/); assert.match(escapeWindowsCmdArgument("percent%PATH%"), /\^%/);
  assert.match(windows.args[3], /oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b/);
  const calls = [];
  await runGcloud(logicalArgs, { platform: "linux", exec: async (executable, args, options) => { calls.push({ executable, args, options }); return { stdout: "ok" }; } });
  assert.equal(calls[0].executable, "gcloud"); assert.deepEqual(calls[0].args, logicalArgs);
  await runGcloud(["--version"], { platform: "win32", env: { ComSpec: "cmd.exe" }, exec: async (executable, args, options) => { calls.push({ executable, args, options }); return { stdout: "ok" }; } });
  assert.equal(calls[1].executable, "cmd.exe"); assert.equal(calls[1].args[0], "/d");
  assert.equal(calls[1].options.windowsVerbatimArguments, true);
});

test("Windows CMD escaping preserves spaces and quotes and blocks metacharacter commands", { skip: process.platform !== "win32" }, async () => {
  const { execFile } = await import("node:child_process");
  const values = ["a value", 'say "hello"', "safe&echo injected", "pipe|echo injected", "less<echo injected", "greater>echo injected", "caret^value", "percent%PATH%", "bang!value", "paren(value)"];
  // Keep the test harness command fixed; exercise the escaping on every
  // logical user argument, including values that contain shell metacharacters.
  const command = ["node", "-e", '"console.log(JSON.stringify(process.argv.slice(1)))"', ...values.map(escapeWindowsCmdArgument)].join(" ");
  const result = await new Promise((resolve, reject) => execFile(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true, windowsVerbatimArguments: true }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}: ${stderr}`)) : resolve({ stdout, stderr })));
  const output = String(result.stdout).trim();
  if (!output) assert.fail(`Windows CMD round-trip returned no stdout; command: ${command}; raw result: ${JSON.stringify(result)}`);
  assert.deepEqual(JSON.parse(output), values);
});

test("log normalization retains structured FIKA errors, generic errors and malformed records", () => {
  const record = normalizeLogRecord({ timestamp: "2026-09-16T10:41:06.401Z", severity: "ERROR", resource: { labels: { service_name: "fika-delivered-in-staging", revision_name: "rev-1" } }, jsonPayload: { app: "delivered-in", event: "delivered_in.requested_week_recovery_failed", operation: "delivered-in.requested-week.recovery", serviceDate: "2026-09-14", oplocId: "oploc:x", errorStatus: 409, errorMessage: "conflicting package content", code: "UNKNOWN_INTERNAL" } });
  assert.equal(record.highlighted, true); assert.equal(record.status, 409); assert.equal(record.event, "delivered_in.requested_week_recovery_failed");
  assert.equal(normalizeLogRecord({ severity: "ERROR", textPayload: "Cloud Run failed" }).highlighted, true);
  assert.equal(normalizeLogRecord(null).malformed, true);
});

test("cloud logging adapter uses authenticated bounded reads", async () => {
  const calls = [];
  const run = async (args) => { calls.push(args); if (args[0] === "auth") return { stdout: "[{\"account\":\"operator@example.com\"}]" }; if (args[0] === "projects") return { stdout: "{}" }; return { stdout: "[{\"timestamp\":\"2026-09-16T10:00:00Z\",\"severity\":\"WARNING\",\"jsonPayload\":{\"app\":\"delivered-in\",\"event\":\"recovery\"}}]" }; };
  const result = await readCloudLogs({ app: "delivered-in", minutes: 1, limit: 2, now: new Date("2026-09-16T10:00:00Z") }, { run });
  assert.equal(result.available, true); assert.equal(result.records.length, 1);
  assert.equal(calls[2][0], "logging"); assert.ok(calls[2].includes("--limit=2")); assert.ok(calls[2].some((arg) => arg.includes('resource.type="cloud_run_revision"')));
});

test("missing gcloud keeps the clear unavailable guidance", async () => {
  const result = await readCloudLogs({ app: "delivered-in", minutes: 1 }, { run: async () => { throw new Error("spawn gcloud ENOENT"); } });
  assert.equal(result.available, false); assert.match(result.warning, /Install the Google Cloud CLI|Google Cloud Shell/); assert.match(result.warning, /gcloud/);
});

test("build discovery handles match, mismatch and unavailable apps", async () => {
  const fetchImpl = async (url) => new Response(JSON.stringify({ buildSha: url.includes("menu") ? "abc1234" : "def5678" }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await discoverBuilds({ expected: "abc1234", fetchImpl });
  assert.equal(result.apps.find((item) => item.app === "menu-planning").status, "MATCH");
  assert.equal(result.apps.find((item) => item.app === "cpu-production").status, "DIFFERENT");
  assert.equal(result.apps.find((item) => item.app === "integration-hub").status, "UNAVAILABLE");
});

test("state normalizers capture targeted Menu, CPU and Delivered-In state", () => {
  const menu = normalizeMenuState({ publications: [{ publicationId: "pub-1", days: [{ publicationDayId: "day-1", date: "2026-09-14", status: "published", version: 8, contentHash: "hash-1", entries: [{ portions: 100, allocations: [{ destinationId: "oploc:x", quantity: 75 }] }] }] }] }, "2026-09-14", "oploc:x");
  assert.equal(menu.status, "published"); assert.equal(menu.totalPortions, 75);
  const cpu = normalizeCpuState({ status: "signed", signatures: [{ role: "production_chef" }, { role: "head_chef_site_manager" }], sourceOrders: [{ productionOrderId: "order-1", sourceIdentity: { sourceContentHash: "hash-1" } }], package: { packageVersion: 2, sourceHash: "hash-1" } }, "2026-09-14", "oploc:x");
  assert.equal(cpu.reviewStatus, "signed"); assert.deepEqual(cpu.signatureRoles, ["production_chef", "head_chef_site_manager"]);
  assert.equal(normalizeCpuState({ packageVersion: 3, contentHash: "cpu-package", sourceVersion: "cpu-change-4" }, "2026-09-14", "oploc:x").releaseStatus, "present");
  assert.deepEqual(normalizeCpuState({ orders: [{ canonicalId: "order-1", destinationOplocId: "oploc:x", sourceContentHash: "hash-1" }] }, "2026-09-14", "oploc:x").orderIds, ["order-1"]);
  const di = normalizeDeliveredState({ projection: { serviceDate: "2026-09-14", state: { freshness: "current", completeness: "complete", menu: "present", cpu: "present" }, entries: [{ id: "e" }], sourceLineage: { menu: { contentHash: "hash-1" } } } }, "2026-09-14", "oploc:x");
  assert.equal(di.targetDatePresent, true); assert.equal(di.freshness, "current");
});

test("state capture uses bounded read endpoints and keeps CPU review opt-in", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("rolling-menu/publications")) return new Response(JSON.stringify({ publications: [] }), { status: 200 });
    if (url.includes("projectionHead")) return new Response(JSON.stringify({ packageVersion: 2, contentHash: "cpu-package", sourceVersion: "cpu-change-2" }), { status: 200 });
    if (url.includes("/api/production")) return new Response(JSON.stringify({ orders: [{ canonicalId: "order-1", destinationOplocId: "oploc:x", sourceContentHash: "hash-1" }] }), { status: 200 });
    return new Response(JSON.stringify({ projection: { serviceDate: "2026-09-14", state: { freshness: "current", completeness: "complete", menu: "present", cpu: "pending" }, entries: [] } }), { status: 200 });
  };
  const state = await captureState({ serviceDate: "2026-09-14", oplocId: "oploc:x", builds: false, env: { FIKA_UAT_MENU_PLANNING_URL: "https://menu.test", FIKA_UAT_CPU_PRODUCTION_URL: "https://cpu.test", FIKA_UAT_DELIVERED_IN_URL: "https://delivered.test" }, fetchImpl });
  assert.deepEqual(state.cpu.orderIds, ["order-1"]); assert.equal(state.cpu.package.packageVersion, 2); assert.equal(urls.some((url) => url.includes("/api/delivered-in/review")), false);
  assert.equal(urls.filter((url) => url.includes("/api/production")).length, 2);
});

const baseState = { target: { serviceDate: "2026-09-14", oplocId: "oploc:x" }, menu: { available: true, status: "published", targetHasAllocations: true, contentHash: "hash-1" }, cpu: { available: true, reviewStatus: "pending" }, deliveredIn: { available: true, targetDatePresent: true, projectionState: "current", freshness: "current", completeness: "complete", menu: "present", cpu: "pending", sourceLineage: { menu: { contentHash: "hash-1" } }, unavailableServiceDates: [], withdrawnServiceDates: [] } };
test("invariants distinguish PASS, FAIL and UNKNOWN", () => {
  assert.equal(evaluateInvariants(baseState).find((item) => item.id === "DI-002").status, "PASS");
  assert.equal(evaluateInvariants({ ...baseState, deliveredIn: { ...baseState.deliveredIn, targetDatePresent: false, menu: "missing" } }).find((item) => item.id === "DI-002").status, "FAIL");
  assert.equal(evaluateInvariants({ ...baseState, deliveredIn: { ...baseState.deliveredIn, freshness: "current", completeness: "complete", sourceLineage: { menu: { contentHash: "other" } } } }).find((item) => item.id === "DI-003").status, "FAIL");
  assert.equal(evaluateInvariants({ ...baseState, deliveredIn: { available: false } }).find((item) => item.id === "DI-003").status, "UNKNOWN");
  assert.equal(evaluateInvariants({ ...baseState, deliveredIn: { ...baseState.deliveredIn, unavailableServiceDates: ["2026-09-14"], withdrawnServiceDates: ["2026-09-14"] } }).find((item) => item.id === "DI-004").status, "FAIL");
});

test("bundle Markdown has target/build/state/log/invariant sections and redacts secrets", () => {
  const markdown = renderMarkdown({ generatedAt: "2026-09-16T10:00:00.000Z", localGitSha: "abc", state: baseState, builds: { apps: [{ label: "Delivered-In", liveSha: "abc", status: "MATCH" }] }, logs: { available: true, filter: "safe", records: [] }, invariants: evaluateInvariants(baseState), causalChains: [], summary: "PASS", });
  assert.match(markdown, /## Target/); assert.match(markdown, /## Builds/); assert.match(markdown, /## Normalized state/); assert.match(markdown, /## Cloud Logging/); assert.match(markdown, /## Invariants/); assert.doesNotMatch(markdown, /secret@example\.com/);
});
