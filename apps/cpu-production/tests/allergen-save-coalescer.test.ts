import assert from "node:assert/strict";
import test from "node:test";
import { createSaveCoalescer } from "../app/ui/allergen-save-coalescer";

const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test("13 rapid edits collapse into one in-flight save plus one trailing save carrying the latest state", async () => {
  const gates: Array<ReturnType<typeof deferred>> = []; const started: number[] = [];
  const saver = createSaveCoalescer<number>(payload => { started.push(payload); const gate = deferred(); gates.push(gate); return gate.promise; });
  const results = Array.from({ length: 13 }, (_, index) => saver.submit(index + 1));
  assert.deepEqual(started, [1], "only the first save is running; nothing else is concurrent");
  gates[0].resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [1, 13], "edits 2-12 were replaced; the trailing save carries the newest full state");
  gates[1].resolve(); await Promise.all(results);
  assert.equal(started.length, 2);
});

test("every caller's promise resolves only after the save containing its state (or a newer one) completed", async () => {
  const gates: Array<ReturnType<typeof deferred>> = []; const saver = createSaveCoalescer<number>(() => { const gate = deferred(); gates.push(gate); return gate.promise; });
  let secondDone = false; const first = saver.submit(1); const second = saver.submit(2).then(() => { secondDone = true; });
  gates[0].resolve(); await first; await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondDone, false, "the trailing save is still running");
  gates[1].resolve(); await second; assert.equal(secondDone, true);
});

test("saves never overlap, and an edit made while the trailing save runs queues a fresh save behind it", async () => {
  let running = 0; let maxRunning = 0; const gates: Array<ReturnType<typeof deferred>> = []; const started: number[] = [];
  const saver = createSaveCoalescer<number>(payload => { started.push(payload); running += 1; maxRunning = Math.max(maxRunning, running); const gate = deferred(); gates.push(gate); return gate.promise.finally(() => { running -= 1; }); });
  saver.submit(1); saver.submit(2);
  gates[0].resolve(); await new Promise(resolve => setImmediate(resolve)); // trailing (2) now running
  const late = saver.submit(3);
  assert.deepEqual(started, [1, 2]);
  gates[1].resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [1, 2, 3]); gates[2].resolve(); await late;
  assert.equal(maxRunning, 1);
});

test("a failed save does not stop the next one, and the queue returns to idle", async () => {
  const gates: Array<ReturnType<typeof deferred>> = []; const started: number[] = [];
  const saver = createSaveCoalescer<number>(payload => { started.push(payload); const gate = deferred(); gates.push(gate); return gate.promise; });
  const first = saver.submit(1).catch(() => "failed"); const second = saver.submit(2);
  gates[0].reject(new Error("server 500")); assert.equal(await first, "failed"); await new Promise(resolve => setImmediate(resolve));
  gates[1].resolve(); await second; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [1, 2]); assert.equal(saver.pending, undefined);
});
