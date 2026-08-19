import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GrabAndGoCategory = "grab_250ml" | "stacking_salad_750ml";
export type GrabAndGoProduct = { productId: string; name: string; category: GrabAndGoCategory; sortOrder: number; active: boolean };
export type GrabAndGoSourceLine = { productId: string; quantity: number; productName: string };
export type GrabAndGoSourceOrder = { orderId: string; oplocId: string; deliveryDate: string; status: "draft" | "submitted" | "cancelled"; version: number; submittedAt: string; lines: GrabAndGoSourceLine[] };
export type GrabAndGoProductionLine = { productId: string; productName: string; category: GrabAndGoCategory; quantity: number; sortOrder: number };
export type GrabAndGoDestination = { oplocId: string; siteName: string; orderId: string; effectiveVersion: number; submittedAt: string; items: GrabAndGoProductionLine[]; totalItems: number };
export type GrabAndGoProduction = { deliveryDate: string; totals: GrabAndGoProductionLine[]; destinations: GrabAndGoDestination[] };

const siteNames: Record<string, string> = {
  "oploc:46701265-15af-48f4-a230-1d27ca21bc59": "Haleon",
  "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d": "FIKA Xchange",
  "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10": "One Angel Court",
  "oploc:8449a63b-4df8-42f7-8b73-1d2c8669f58c": "Commerzbank",
};

function dataFile(name: string) { const candidates = [join(process.cwd(), "..", "delivered-in", "local-data", "delivered-in", name), join(process.cwd(), "apps", "delivered-in", "local-data", "delivered-in", name)]; return candidates.find(existsSync); }
function readJson<T>(name: string, fallback: T): T { const file = dataFile(name); if (!file) return fallback; try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; } }

export function effectiveGrabAndGoOrders(orders: GrabAndGoSourceOrder[], deliveryDate: string) {
  const latest = new Map<string, GrabAndGoSourceOrder>();
  for (const order of orders.filter(candidate => candidate.deliveryDate === deliveryDate)) {
    const key = `${order.oplocId}|${order.deliveryDate}`; const existing = latest.get(key);
    if (!existing || order.version > existing.version) latest.set(key, order);
  }
  return [...latest.values()].filter(order => order.status === "submitted");
}

export function buildGrabAndGoProduction(deliveryDate: string, orders: GrabAndGoSourceOrder[], catalogue: GrabAndGoProduct[], labels: Record<string, string> = siteNames): GrabAndGoProduction {
  const products = new Map(catalogue.filter(product => product.active).map(product => [product.productId, product]));
  const destinations = effectiveGrabAndGoOrders(orders, deliveryDate).map(order => {
    const items = order.lines.filter(line => line.quantity > 0).flatMap(line => { const product = products.get(line.productId); return product ? [{ productId: line.productId, productName: line.productName, category: product.category, quantity: line.quantity, sortOrder: product.sortOrder }] : []; }).sort((a, b) => a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName));
    return { oplocId: order.oplocId, siteName: labels[order.oplocId] || order.oplocId, orderId: order.orderId, effectiveVersion: order.version, submittedAt: order.submittedAt, items, totalItems: items.reduce((sum, item) => sum + item.quantity, 0) };
  }).filter(destination => destination.items.length);
  const totals = [...destinations.reduce((map, destination) => { for (const item of destination.items) { const key = item.productId; const existing = map.get(key); map.set(key, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item }); } return map; }, new Map<string, GrabAndGoProductionLine>()).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName));
  return { deliveryDate, totals, destinations };
}

export function readGrabAndGoProduction(deliveryDate: string): GrabAndGoProduction {
  const orderData = readJson<{ orders?: GrabAndGoSourceOrder[] }>("grab-and-go-orders.json", {});
  const catalogueData = readJson<{ products?: GrabAndGoProduct[] }>("grab-and-go-catalogue.json", {});
  return buildGrabAndGoProduction(deliveryDate, orderData.orders || [], catalogueData.products || []);
}

export function relevantGrabAndGoDates(orders: GrabAndGoSourceOrder[]) { return [...new Set(orders.filter(order => order.status === "submitted").map(order => order.deliveryDate))].sort(); }
