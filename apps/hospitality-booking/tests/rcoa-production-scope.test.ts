import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const productionConfig = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");

function buffetFlag(config: string) {
  const match = config.match(/- variable: NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED\r?\n\s+value: "(true|false)"/);
  return match?.[1];
}

test("Hot Fork Buffet remains enabled in staging and disabled for a production release", () => {
  assert.equal(buffetFlag(stagingConfig), "true");
  assert.equal(buffetFlag(productionConfig), "false");
});
