import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GrabAndGoOrder, GrabAndGoProduct } from "./grab-and-go";

type Stored = { version: 1; orders: GrabAndGoOrder[] };
const file = join(process.cwd(), "local-data", "delivered-in", "grab-and-go-orders.json");
const unavailable = (message: string, cause?: unknown) => Object.assign(new Error(message, cause ? { cause } : undefined), { status: 503 });
const read = (): Stored => { if (!existsSync(file)) return { version: 1, orders: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Stored>; if (!Array.isArray(value.orders)) throw new Error("orders is not an array"); return { version: 1, orders: value.orders }; } catch (cause) { throw unavailable("Grab & Go order data is unavailable; no order list was loaded.", cause); } };
const write = (value: Stored) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };
const catalogueFile = join(process.cwd(), "local-data", "delivered-in", "grab-and-go-catalogue.json");
export function readGrabAndGoCatalogue(): GrabAndGoProduct[] { try { const value = JSON.parse(readFileSync(catalogueFile, "utf8")) as { products?: GrabAndGoProduct[] }; if (!Array.isArray(value.products)) throw new Error("products is not an array"); return value.products; } catch (cause) { throw unavailable("Grab & Go catalogue is unavailable; no product list was loaded.", cause); } }
export function listGrabAndGoOrders(oplocId?: string) { return read().orders.filter(order => !oplocId || order.oplocId === oplocId); }
export function getGrabAndGoOrder(oplocId: string, deliveryDate: string) { return read().orders.find(order => order.oplocId === oplocId && order.deliveryDate === deliveryDate); }
export function saveGrabAndGoOrder(order: GrabAndGoOrder) { const stored = read(); const index = stored.orders.findIndex(value => value.orderId === order.orderId); if (index >= 0) stored.orders[index] = order; else stored.orders.push(order); write(stored); return order; }
