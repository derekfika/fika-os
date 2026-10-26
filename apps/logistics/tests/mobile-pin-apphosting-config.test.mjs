import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const appRoot = join(directory, "..");
const bindings = [
  ["LOGISTICS_MOBILE_SESSION_SECRET", "LOGISTICS_MOBILE_SESSION_SECRET@1"],
  ["LOGISTICS_MOBILE_VAN1_PIN_VERIFIER", "LOGISTICS_MOBILE_VAN1_PIN_VERIFIER@1"],
  ["LOGISTICS_MOBILE_VAN2_PIN_VERIFIER", "LOGISTICS_MOBILE_VAN2_PIN_VERIFIER@1"],
];

const readConfig = file => readFile(join(appRoot, file), "utf8");

test("staging App Hosting config pins every mobile PIN secret for runtime", async () => {
  const staging = await readConfig("apphosting.staging.yaml");

  for (const [variable, secret] of bindings) {
    const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSecret = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      staging,
      new RegExp(`- variable: ${escapedVariable}\\s+secret: ${escapedSecret}\\s+availability: \\[RUNTIME\\]`),
      `${variable} must reference ${secret} at runtime in the staging config`,
    );
  }
});

test("staging PIN secret bindings do not enter shared or production App Hosting config", async () => {
  const [shared, production] = await Promise.all([
    readConfig("apphosting.yaml"),
    readConfig("apphosting.production.yaml"),
  ]);

  for (const [variable, secret] of bindings) {
    assert.doesNotMatch(shared, new RegExp(variable), `${variable} must remain staging-only`);
    assert.doesNotMatch(shared, new RegExp(secret), `${secret} must remain staging-only`);
    assert.doesNotMatch(production, new RegExp(variable), `${variable} must not enter production config`);
    assert.doesNotMatch(production, new RegExp(secret), `${secret} must not enter production config`);
  }
});
