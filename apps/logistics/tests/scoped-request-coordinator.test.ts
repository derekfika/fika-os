import assert from "node:assert/strict";
import test from "node:test";
import { ScopedRequestCoordinator } from "../lib/scoped-request-coordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("date requests are deduplicated only within their captured date generation", async () => {
  const coordinator = new ScopedRequestCoordinator();
  const monday = coordinator.activate("2026-10-05");
  const mondayResponse = deferred<string>();
  const mondayLoad = coordinator.run(monday, () => mondayResponse.promise);
  assert.equal(coordinator.run(monday, () => Promise.resolve("duplicate")), mondayLoad);

  const tuesday = coordinator.activate("2026-10-06");
  const tuesdayResponse = deferred<string>();
  const tuesdayLoad = coordinator.run(tuesday, () => tuesdayResponse.promise);
  let visible = "";
  tuesdayResponse.resolve("Tuesday projection");
  coordinator.commit(tuesday, () => { visible = "Tuesday projection"; });
  await tuesdayLoad;
  mondayResponse.resolve("Monday projection");
  coordinator.commit(monday, () => { visible = "Monday projection"; });
  await mondayLoad;

  assert.equal(visible, "Tuesday projection");
  assert.notEqual(mondayLoad, tuesdayLoad);
});

test("cache, convergence and mutation outcomes cannot commit through an inactive context", () => {
  const coordinator = new ScopedRequestCoordinator();
  const monday = coordinator.activate("2026-10-05");
  const tuesday = coordinator.activate("2026-10-06");
  const applied: string[] = [];

  assert.equal(coordinator.commit(monday, () => applied.push("cached Monday")), false);
  assert.equal(coordinator.commit(monday, () => applied.push("converged Monday")), false);
  assert.equal(coordinator.commit(monday, () => applied.push("placement success / 409 / uncertain")), false);
  assert.equal(coordinator.commit(tuesday, () => applied.push("Tuesday")), true);
  assert.deepEqual(applied, ["Tuesday"]);
});

test("revisiting a date creates a newer generation and rejects its earlier response", () => {
  const coordinator = new ScopedRequestCoordinator();
  const monday1 = coordinator.activate("2026-10-05");
  const tuesday = coordinator.activate("2026-10-06");
  const monday2 = coordinator.activate("2026-10-05");
  assert.notEqual(monday1.generation, monday2.generation);
  assert.equal(coordinator.isCurrent(tuesday), false);
  assert.equal(coordinator.isCurrent(monday1), false);
  assert.equal(coordinator.isCurrent(monday2), true);
});

test("old week summaries cannot replace the newly selected week", () => {
  const coordinator = new ScopedRequestCoordinator();
  const week1 = coordinator.activate("week:2026-10-05");
  const week2 = coordinator.activate("week:2026-10-12");
  let visible = "week 2";
  coordinator.commit(week1, () => { visible = "week 1"; });
  assert.equal(visible, "week 2");
  assert.equal(coordinator.commit(week2, () => { visible = "week 2 current"; }), true);
  assert.equal(visible, "week 2 current");
});

test("controlled late desktop cache, head, projection and convergence stages never render on another date", async () => {
  const coordinator = new ScopedRequestCoordinator();
  const monday = coordinator.activate("2026-10-05");
  const cache = deferred<string>(); const head = deferred<string>(); const projection = deferred<string>(); const incremental = deferred<string>();
  let visible = "Loading Monday";
  const mondayLoad = coordinator.run(monday, async () => {
    const cached = await cache.promise;
    coordinator.commit(monday, () => { visible = cached; });
    const syncHead = await head.promise;
    coordinator.commit(monday, () => { visible = syncHead; });
    const projected = await projection.promise;
    coordinator.commit(monday, () => { visible = projected; });
    const converged = await incremental.promise;
    coordinator.commit(monday, () => { visible = converged; });
  });

  const tuesday = coordinator.activate("2026-10-06");
  const tuesdayResponse = deferred<string>();
  const tuesdayLoad = coordinator.run(tuesday, async () => {
    const value = await tuesdayResponse.promise;
    coordinator.commit(tuesday, () => { visible = value; });
  });
  tuesdayResponse.resolve("Tuesday projection");
  await tuesdayLoad;
  for (const [stage, response] of [["cache", cache], ["head", head], ["projection", projection], ["incremental", incremental]] as const) {
    response.resolve(`Monday ${stage}`);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(visible, "Tuesday projection", `${stage} stage must stay scoped to Monday`);
  }
  await mondayLoad;
});

test("delayed Monday placement success, 409 and uncertain outcomes do not affect Tuesday", async () => {
  const coordinator = new ScopedRequestCoordinator();
  const monday = coordinator.activate("2026-10-05");
  const mutation = deferred<"success" | "409" | "uncertain">();
  let visibleAuthority = "Tuesday authority";
  const command = coordinator.run(monday, async () => {
    const outcome = await mutation.promise;
    coordinator.commit(monday, () => { visibleAuthority = `Monday ${outcome}`; });
  });
  coordinator.activate("2026-10-06");
  mutation.resolve("success"); await command;
  assert.equal(visibleAuthority, "Tuesday authority");

  for (const outcome of ["409", "uncertain"] as const) {
    const context = coordinator.activate("2026-10-05");
    const response = deferred<typeof outcome>();
    const delayed = coordinator.run(context, async () => {
      const result = await response.promise;
      coordinator.commit(context, () => { visibleAuthority = `Monday ${result}`; });
    });
    coordinator.activate("2026-10-06");
    response.resolve(outcome); await delayed;
    assert.equal(visibleAuthority, "Tuesday authority");
  }
});
