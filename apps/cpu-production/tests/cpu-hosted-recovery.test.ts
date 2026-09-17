import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted CPU outbox recovery is documented as Cloud Scheduler provisioning, not an App Hosting loop", async () => {
  const guide = await readFile(new URL("../../../docs/deployment/cpu-durable-outbox-scheduler.md", import.meta.url), "utf8");
  assert.match(guide, /Firebase App Hosting runs the CPU Next application only/);
  assert.match(guide, /gcloud scheduler jobs create http/);
  assert.match(guide, /schedule=\"\* \* \* \* \*\"/);
  assert.match(guide, /api\/internal\/durable-outbox/);
  assert.match(guide, /limit.*25/);
  assert.match(guide, /not complete/);
});
