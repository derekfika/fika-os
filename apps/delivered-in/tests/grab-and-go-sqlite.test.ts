import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { applyOrderAction, rotationWeekForDate, type GrabAndGoOrder, type GrabAndGoProduct } from "../lib/grab-and-go";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "fika-grab-sqlite-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: (_app: string, ...parts: string[]) => join(directory, parts.at(-1)!) },
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db: { collection: () => { throw new Error("Local SQLite regression must not access Firestore."); } } },
    [resolve(appRoot, "lib/grab-and-go-handoff.ts")]: { stageGrabHandoff: () => { throw new Error("Local SQLite regression must not stage hosted work."); } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
    "@fika/server-shared/data-source-meter-server": { recordDataAccess() {} },
  } });
  const store: typeof import("../lib/grab-and-go-store") = load(resolve(appRoot, "lib/grab-and-go-store.ts"));
  return { directory, databaseFile: join(directory, "grab-and-go.sqlite"), jsonFile: join(directory, "grab-and-go-orders.json"), store };
}

function submitted(): GrabAndGoOrder {
  const deliveryDate = "2099-08-24";
  const product: GrabAndGoProduct = { productId: "product:owned-sqlite", name: "Owned pot", category: "grab_250ml", rotationWeeks: [rotationWeekForDate(deliveryDate)], allowedDeliveryWeekdays: ["Monday"], active: true, sortOrder: 1, price: 1 };
  return applyOrderAction(undefined, { action: "submit", oplocId: "oploc:owned-sqlite", deliveryDate, rotationWeek: 1, lines: [{ productId: product.productId, quantity: 3 }], actor: "isolated-test", at: "2099-08-20T09:00:00Z" }, [product]);
}

test("Grab & Go SQLite rejects a second amendment from the same expected version", t => {
  const { store } = fixture(t), initial = submitted();
  store.saveGrabAndGoOrder(initial);
  const first = { ...initial, version: 2, lines: initial.lines.map(line => ({ ...line, quantity: 4 })) };
  const stale = { ...initial, version: 2, lines: initial.lines.map(line => ({ ...line, quantity: 5 })) };
  store.saveGrabAndGoOrder(first, 1);
  assert.throws(() => store.saveGrabAndGoOrder(stale, 1), (error: any) => error.status === 409);
  assert.equal(store.getGrabAndGoOrder(initial.oplocId, initial.deliveryDate)?.lines[0].quantity, 4);
});

test("Grab & Go outbox consumer does not hold the SQLite writer", async t => {
  const { store } = fixture(t), initial = submitted();
  store.saveGrabAndGoOrder(initial);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const replay = store.replayGrabAndGoOutbox(async () => { entered(); await waiting; });
  await started;
  try {
    store.saveGrabAndGoOrder({ ...initial, version: 2 }, 1);
    assert.equal(store.getGrabAndGoOrder(initial.oplocId, initial.deliveryDate)?.version, 2);
  } finally { release(); }
  await replay;
});

test("corrupt Grab & Go SQLite recovers exact orders and history from a preserved JSON source", t => {
  const { store, directory, databaseFile, jsonFile } = fixture(t), order = submitted();
  const source = { version: 1, orders: [order], events: [] };
  writeFileSync(jsonFile, JSON.stringify(source));
  writeFileSync(databaseFile, "corrupt persistence");
  assert.deepEqual(store.listGrabAndGoOrders(), [order]);
  assert.deepEqual(store.listGrabAndGoOrders(), [order]);
  assert.deepEqual(store.getGrabAndGoOrder(order.oplocId, order.deliveryDate)?.history, order.history);
  const backups = readdirSync(directory).filter(name => name.startsWith("grab-and-go.sqlite.corrupt-") && name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(directory, backups[0]), "utf8"), "corrupt persistence");
  assert.deepEqual(JSON.parse(readFileSync(jsonFile, "utf8")), source);
});

test("corrupt Grab & Go SQLite without a recovery source fails closed and preserves the original bytes", t => {
  const { store, directory, databaseFile } = fixture(t);
  writeFileSync(databaseFile, "corrupt persistence");
  assert.throws(() => store.listGrabAndGoOrders(), (error: any) => error.status === 503 && error.cause?.errcode === 26);
  assert.equal(readFileSync(databaseFile, "utf8"), "corrupt persistence");
  assert.equal(readdirSync(directory).filter(name => name.endsWith(".bak")).length, 0);
});

test("invalid Grab & Go JSON recovery source cannot replace corrupt SQLite with an empty list", t => {
  const { store, directory, databaseFile, jsonFile } = fixture(t);
  writeFileSync(databaseFile, "corrupt persistence");
  writeFileSync(jsonFile, JSON.stringify({ version: 1, orders: "invalid", events: [] }));
  assert.throws(() => store.listGrabAndGoOrders(), (error: any) => error.status === 503 && /order data is unavailable/.test(error.message));
  assert.equal(readFileSync(databaseFile, "utf8"), "corrupt persistence");
  assert.equal(readdirSync(directory).filter(name => name.endsWith(".bak")).length, 0);
});
