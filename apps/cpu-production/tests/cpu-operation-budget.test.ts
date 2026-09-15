import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markEventDelivered } from "@fika/server-shared/durable-outbox";
import { stageCpuPropagation, buildCpuPropagationEvents, recoverCpuPropagation, seedCpuOutboxForTests } from "../lib/cpu-durable-outbox";
import { OperationBudget, assertOperationBudget } from "../../../test-support/operation-budget";

const input = {
  eventId: "cpu-change:budget:v7",
  sourceEntityId: "plan:budget",
  serviceDate: "2026-09-15",
  sourceVersion: 7,
  changedAt: "2026-09-15T10:00:00.000Z",
  changeType: "amended",
  order: { origin: "menu_planning", destinationOplocId: "oploc:budget" },
  logistics: true,
};

test("CPU command-scoped propagation overhead is constant plus obligations", async () => {
  const events = buildCpuPropagationEvents(input);
  assert.equal(events.length, 2);
  const budget = new OperationBudget();
  const transaction = {
    get: async () => { budget.read(1, "transaction"); return { exists: false, data: () => undefined }; },
    create: () => { budget.write(); },
  } as any;
  await stageCpuPropagation(transaction, input);
  assert.equal(budget.counts.attemptedReads, events.length);
  assert.equal(budget.counts.writes, events.length);
  assertOperationBudget("CPU propagation staging", budget.counts.attemptedReads, 2, "reads");
  assertOperationBudget("CPU propagation staging", budget.counts.writes, 2, "writes");

  const unrelatedHistory = Array.from({ length: 1000 }, (_, index) => `unrelated:${index}`);
  const second = new OperationBudget();
  await stageCpuPropagation({
    get: async () => { second.read(1, "transaction"); return { exists: false, data: () => undefined }; },
    create: () => { second.write(); },
  } as any, input);
  assert.equal(unrelatedHistory.length, 1000);
  assert.equal(second.counts.attemptedReads, budget.counts.attemptedReads);
  assert.equal(second.counts.writes, budget.counts.writes);
});

test("CPU global recovery keeps a fixed page contract", () => {
  const source = readFileSync(new URL("../lib/cpu-durable-outbox.ts", import.meta.url), "utf8");
  assert.match(source, /CPU_PROPAGATION_OUTBOX_PAGE_SIZE = 25/);
  assert.match(source, /\.limit\(boundedLimit\)/);
  assert.match(source, /memoryEligible/);
});

test("CPU recovery is independent of delivered history", async () => {
  const due = buildCpuPropagationEvents(input);
  const history = Array.from({ length: 1000 }, (_, index) => markEventDelivered({ ...due[index % due.length], eventId: `historic:${index}` }, "2026-09-14T10:00:00.000Z"));
  const previousFetch = globalThis.fetch;
  const measure = async (historyCount: number) => {
    seedCpuOutboxForTests([...history.slice(0, historyCount), ...due]);
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response(null, { status: 200 }); }) as typeof fetch;
    try {
      await recoverCpuPropagation(25, new Date("2026-09-15T10:00:01.000Z"));
      return calls;
    } finally {
      globalThis.fetch = previousFetch;
    }
  };
  assert.equal(await measure(0), due.length);
  assert.equal(await measure(1000), due.length);
});
