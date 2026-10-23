import test from "node:test";
import assert from "node:assert/strict";
import { assertPackingOrigin } from "../lib/packing-origin";
for (const [mode, origin] of [
  ["staging", "https://cpu-staging.fikacatering.com"],
  ["production", "https://cpu.fikacatering.com"],
]) {
  const env = { FIKA_RUNTIME_MODE: mode, CPU_PUBLIC_BASE_URL: origin };
  test(`packing ${mode}: configured public origin survives App Hosting internal URL and forwarding`, () => {
    assert.doesNotThrow(() =>
      assertPackingOrigin(
        new Request("http://localhost:8080/api/packing", {
          headers: {
            origin,
            "x-forwarded-host": new URL(origin).host,
            "x-forwarded-proto": "https",
          },
        }),
        env,
      ),
    );
  });
  test(`packing ${mode}: foreign, sibling app, spoofed forwarding, null and missing origins fail closed`, () => {
    for (const foreign of [
      "https://attacker.example",
      "https://os.fikacatering.com",
      mode === "staging"
        ? "https://cpu.fikacatering.com"
        : "https://cpu-staging.fikacatering.com",
      "null",
      "",
    ]) {
      assert.throws(
        () =>
          assertPackingOrigin(
            new Request("http://localhost:8080/api/packing", {
              headers: {
                ...(foreign ? { origin: foreign } : {}),
                "x-forwarded-host": "attacker.example",
                "x-forwarded-proto": "https",
              },
            }),
            env,
          ),
        /Cross-origin/,
      );
    }
  });
}
test("packing hosted origin configuration cannot silently select a foreign host or wrong environment", () => {
  for (const configured of [
    undefined,
    "https://attacker.example",
    "https://cpu.fikacatering.com",
    "http://cpu-staging.fikacatering.com",
    "https://cpu-staging.fikacatering.com/extra",
  ]) {
    assert.throws(
      () =>
        assertPackingOrigin(
          new Request("http://localhost:8080", {
            headers: { origin: "https://cpu-staging.fikacatering.com" },
          }),
          { FIKA_RUNTIME_MODE: "staging", CPU_PUBLIC_BASE_URL: configured },
        ),
      /configured/,
    );
  }
});
test("packing local requests require exact local Origin and ignore forwarded hosts", () => {
  assert.doesNotThrow(() =>
    assertPackingOrigin(
      new Request("http://localhost/api/packing", {
        headers: { origin: "http://localhost" },
      }),
      { FIKA_RUNTIME_MODE: "local" },
    ),
  );
  assert.throws(
    () =>
      assertPackingOrigin(
        new Request("http://localhost/api/packing", {
          headers: {
            origin: "https://attacker.example",
            "x-forwarded-host": "attacker.example",
          },
        }),
        { FIKA_RUNTIME_MODE: "local" },
      ),
    /Cross-origin/,
  );
});
