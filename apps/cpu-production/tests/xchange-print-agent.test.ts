import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Xchange print-agent durability, authentication and fake-printer regressions", () => {
  const scriptArgs = ["-m", "unittest", "discover", "-s", "tools/xchange-print-agent", "-p", "test_*.py", "-v"];
  const candidates = process.platform === "win32"
    ? [{ command: "py", prefix: ["-3"] }, { command: "python", prefix: [] }]
    : [{ command: "python3", prefix: [] }, { command: "python", prefix: [] }];

  let result: ReturnType<typeof spawnSync> | undefined;
  for (const candidate of candidates) {
    result = spawnSync(candidate.command, [...candidate.prefix, ...scriptArgs], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    if (!result.error || (result.error as NodeJS.ErrnoException).code !== "ENOENT") break;
  }
  assert.ok(result, "Python test runner was not selected");
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
});
