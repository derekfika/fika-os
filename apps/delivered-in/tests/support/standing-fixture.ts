import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrabAndGoOrder, GrabAndGoProduct } from "../../lib/grab-and-go";

const require = createRequire(import.meta.url);
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { typescriptLoader } = require("../../../../scripts/testing/load-typescript.cjs");

export const OPLOC = "oploc:owned";
export const OTHER = "oploc:other";
/** Monday 12:01 London (GMT) — the Wednesday generation moment. Wed 11-04 is due; Mon 11-09 is scheduled for Thu 11-05 12:01. */
export const MON = new Date("2026-11-02T12:01:00Z");
export const THU = new Date("2026-11-05T12:01:00Z");
export const product = (id: string, extra: Partial<GrabAndGoProduct> = {}): GrabAndGoProduct => ({ productId: id, name: id, category: "grab_250ml", rotationWeeks: [1, 2, 3, 4], allowedDeliveryWeekdays: ["Monday", "Wednesday"], active: true, sortOrder: 1, price: 1, ...extra });
export const catalogue = (): GrabAndGoProduct[] => [product("p:a", { sortOrder: 1 }), product("p:b", { sortOrder: 2 }), product("p:wk4mon", { sortOrder: 3, rotationWeeks: [4], allowedDeliveryWeekdays: ["Monday"] })];
/** Week 3 Wed (11-04), week 4 Mon (11-09), week 4 Wed (11-11) are configured; week 1 Monday (11-16) is deliberately not. */
export const SLOTS = { "3:Wednesday": [{ productId: "p:a", quantity: 5 }], "4:Monday": [{ productId: "p:a", quantity: 6 }, { productId: "p:b", quantity: 2 }], "4:Wednesday": [{ productId: "p:b", quantity: 7 }] };

/** In-memory Firestore double: serialised transactions, reads-before-writes enforced, equality/orderBy/limit queries. */
export function fakeFirestore() {
  const records = new Map<string, any>(), queries: any[] = []; let queue = Promise.resolve();
  const snapshot = (ref: any) => ({ exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const collection = (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, get: async function () { return snapshot(this); }, create: async function (data: any) { if (records.has(this.path)) throw Object.assign(new Error("already exists"), { code: 6 }); records.set(this.path, structuredClone(data)); } }),
    where: (field: string, operator: string, value: unknown) => {
      const filters = [{ field, operator, value }]; let sort = "", direction = "asc", limit = 0;
      const query: any = {
        where(f: string, o: string, v: unknown) { filters.push({ field: f, operator: o, value: v }); return query; },
        orderBy(f: string, d = "asc") { sort = f; direction = d; return query; },
        limit(n: number) { limit = n; return query; },
        async get() {
          queries.push({ name, filters: structuredClone(filters), sort, limit });
          let rows = [...records.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, row]) => row).filter(row => filters.every(filter => filter.operator === "in" ? (filter.value as unknown[]).includes(row[filter.field]) : filter.operator === "<=" ? row[filter.field] !== undefined && row[filter.field] <= (filter.value as string) : row[filter.field] === filter.value));
          if (sort) rows = rows.sort((a, b) => (direction === "desc" ? -1 : 1) * (a[sort] < b[sort] ? -1 : a[sort] > b[sort] ? 1 : 0));
          rows = rows.slice(0, limit || rows.length);
          return { size: rows.length, docs: rows.map(row => ({ data: () => structuredClone(row) })) };
        },
      };
      return query;
    },
  });
  const db = { collection, runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      const writes: Array<[any, any, boolean]> = [];
      const result = await callback({ get: async (ref: any) => { if (writes.length) throw new Error("reads must precede writes"); return snapshot(ref); }, set: (ref: any, data: any) => writes.push([ref, data, false]), create: (ref: any, data: any) => writes.push([ref, data, true]) });
      for (const [ref, , create] of writes) if (create && records.has(ref.path)) throw Object.assign(new Error("already exists"), { status: 409 });
      for (const [ref, data] of writes) { if (Object.values(data).some(value => value === undefined)) throw new Error("Firestore rejects undefined fields"); records.set(ref.path, structuredClone(data)); }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } };
  return { db, records, queries };
}

/** Loads the real standing-order modules through the diskless loader with the given Firestore handle. */
export function standingModules(db: unknown, options: { access?: () => any } = {}) {
  const calls: any[] = []; let products = catalogue(), failForward = false;
  const access = { current: { email: "manager@example.test", oplocIds: [OPLOC], permissions: ["delivered_in.view"] } };
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db },
    [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { calls.push(structuredClone(input)); if (failForward) throw new Error("isolated CPU outage"); return "delivered"; } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
    [resolve(appRoot, "lib/server.ts")]: { resolveAccess: async () => ({ access: options.access ? options.access() : access.current, sites: [] }), deliveredInErrorBody: (error: Error) => ({ error: { message: error.message } }) },
    [resolve(appRoot, "lib/grab-and-go-catalogue-client.ts")]: { getGrabAndGoCataloguePackage: async () => ({ catalogue: { schemaVersion: 1, products: structuredClone(products) }, manifest: {} }) },
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: () => "unused-isolated-hosted-store" },
    "@fika/server-shared/data-source-meter-server": { recordDataAccess() {}, withDataTrace: (_trace: any, fn: any) => fn() },
  } });
  const service: typeof import("../../lib/grab-and-go-standing-service") = load(resolve(appRoot, "lib/grab-and-go-standing-service.ts"));
  const store: typeof import("../../lib/grab-and-go-store") = load(resolve(appRoot, "lib/grab-and-go-store.ts"));
  const handoff: typeof import("../../lib/grab-and-go-handoff") = load(resolve(appRoot, "lib/grab-and-go-handoff.ts"));
  const standing: typeof import("../../lib/grab-and-go-standing") = load(resolve(appRoot, "lib/grab-and-go-standing.ts"));
  return {
    load, service, store, handoff, standing, calls, access,
    setCatalogue: (next: GrabAndGoProduct[]) => { products = next; }, catalogue: () => structuredClone(products), failForward: (value: boolean) => { failForward = value; },
    mutate: (input: Partial<Parameters<typeof service.mutateStandingOrder>[0]> & { action: any }, at = MON) => service.mutateStandingOrder({ oplocId: OPLOC, actor: "manager@example.test", ...input } as any, products, at),
    run: (at: Date, extra: Partial<Parameters<typeof service.runStandingGeneration>[0]> = {}) => service.runStandingGeneration({ catalogue: structuredClone(products), now: at, ...extra }),
  };
}
export type Modules = ReturnType<typeof standingModules>;
export const lines = (order: GrabAndGoOrder) => order.lines.map(line => `${line.productId}:${line.quantity}`).join(",");

/** Draft + activate (no orders are generated by either). */
export async function activate(m: Modules, slots: unknown = SLOTS, at = MON) {
  const draft = await m.mutate({ action: "save", slots }, at);
  return m.mutate({ action: "activate", expectedVersion: draft.standingOrder.version }, at);
}
export function withHostedRuntime<T>(run: () => Promise<T>) {
  const previous = process.env.FIKA_RUNTIME_MODE; process.env.FIKA_RUNTIME_MODE = "staging";
  return run().finally(() => { if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous; });
}
