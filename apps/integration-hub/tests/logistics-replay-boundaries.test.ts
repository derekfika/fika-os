import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Logistics outbox replay batches due events through one projection notification", () => {
  const outbox = readFileSync(new URL("../lib/logistics-projection-outbox.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../lib/logistics-projection-client.ts", import.meta.url), "utf8");
  assert.match(outbox, /deliverLogisticsProjectionBatch/);
  assert.match(outbox, /notifyLogisticsProjectionBatch\(ready\.map/);
  assert.match(outbox, /eventIsDue\(current\)/);
  assert.match(outbox, /markEventFailed\(claim\.event, error/);
  assert.match(client, /JSON\.stringify\(payload\)/);
  assert.match(client, /response\.clone\(\)\.json/);
  assert.match(client, /error\.message/);
});

test("bounded Logistics outbox recovery has an explicit scheduler pattern", () => {
  const scheduler = readFileSync(new URL("../../docs/deployment/integration-hub-logistics-outbox-scheduler.md", import.meta.url), "utf8");
  assert.match(scheduler, /gcloud scheduler jobs create http/);
  assert.match(scheduler, /--message-body='\{"limit":25\}'/);
  assert.match(scheduler, /bounded batch/);
});
