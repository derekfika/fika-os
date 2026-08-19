export type GrabAndGoCategory = "grab_250ml" | "stacking_salad_750ml";
export type GrabAndGoProduct = { productId: string; name: string; category: GrabAndGoCategory; sortOrder: number; active: boolean };
export type GrabAndGoSourceLine = { productId: string; quantity: number; productName: string; category?: GrabAndGoCategory; sortOrder?: number; price?: number };
export type GrabAndGoSourceOrder = { orderId: string; oplocId: string; deliveryDate: string; status: "draft" | "submitted" | "cancelled"; version: number; submittedAt: string; lines: GrabAndGoSourceLine[] };
export type GrabAndGoProductionLine = { productId: string; productName: string; category: GrabAndGoCategory | "unknown"; quantity: number; sortOrder: number };
export type GrabAndGoDestination = { oplocId: string; siteName: string; orderId: string; effectiveVersion: number; submittedAt: string; items: GrabAndGoProductionLine[]; totalItems: number };
export type GrabAndGoProduction = { deliveryDate: string; totals: GrabAndGoProductionLine[]; destinations: GrabAndGoDestination[] };

export function effectiveGrabAndGoOrders(orders: GrabAndGoSourceOrder[], deliveryDate: string) {
  const latest = new Map<string, GrabAndGoSourceOrder>();
  for (const order of orders.filter(candidate => candidate.deliveryDate === deliveryDate)) {
    const key = `${order.oplocId}|${order.deliveryDate}`; const existing = latest.get(key);
    if (!existing || order.version > existing.version) latest.set(key, order);
  }
  return [...latest.values()].filter(order => order.status === "submitted");
}

export function buildGrabAndGoProduction(deliveryDate: string, orders: GrabAndGoSourceOrder[], catalogue: GrabAndGoProduct[] = [], labels: Record<string, string> = {}): GrabAndGoProduction {
  const products = new Map(catalogue.map(product => [product.productId, product]));
  const destinations = effectiveGrabAndGoOrders(orders, deliveryDate).map(order => {
    const items = order.lines.filter(line => line.quantity > 0).map(line => { const product = products.get(line.productId); const category: GrabAndGoProductionLine["category"] = line.category || product?.category || "unknown"; return { productId: line.productId, productName: line.productName, category, quantity: line.quantity, sortOrder: line.sortOrder ?? product?.sortOrder ?? Number.MAX_SAFE_INTEGER }; }).sort((a, b) => a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName));
    return { oplocId: order.oplocId, siteName: labels[order.oplocId] || order.oplocId, orderId: order.orderId, effectiveVersion: order.version, submittedAt: order.submittedAt, items, totalItems: items.reduce((sum, item) => sum + item.quantity, 0) };
  }).filter(destination => destination.items.length);
  const totals = [...destinations.reduce((map, destination) => { for (const item of destination.items) { const key = item.productId; const existing = map.get(key); map.set(key, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item }); } return map; }, new Map<string, GrabAndGoProductionLine>()).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName));
  return { deliveryDate, totals, destinations };
}

export function relevantGrabAndGoDates(orders: GrabAndGoSourceOrder[]) { return [...new Set(orders.filter(order => order.status === "submitted").map(order => order.deliveryDate))].sort(); }

export type GrabAndGoSourceResponse = { orders: GrabAndGoSourceOrder[]; catalogue?: GrabAndGoProduct[] };
export function deliveredInGrabAndGoUrl(deliveryDate?: string) { const base = process.env.DELIVERED_IN_GRAB_AND_GO_API_URL || "http://localhost:3800/api/delivered-in/grab-and-go/production"; return deliveryDate ? `${base}?deliveryDate=${encodeURIComponent(deliveryDate)}` : base; }
export async function readGrabAndGoSource(deliveryDate?: string, fetcher: typeof fetch = fetch): Promise<GrabAndGoSourceResponse> {
  const headers = process.env.DELIVERED_IN_INTERNAL_API_TOKEN ? { authorization: `Bearer ${process.env.DELIVERED_IN_INTERNAL_API_TOKEN}` } : undefined;
  const response = await fetcher(deliveredInGrabAndGoUrl(deliveryDate), { cache: "no-store", headers });
  if (!response.ok) throw new Error(`Delivered-In Grab & Go source is unavailable (${response.status}).`);
  const body = await response.json() as GrabAndGoSourceResponse & { error?: { message?: string } };
  if (!Array.isArray(body.orders)) throw new Error(body.error?.message || "Delivered-In Grab & Go source returned invalid data.");
  return body;
}

export async function readGrabAndGoProduction(deliveryDate: string): Promise<GrabAndGoProduction> {
  const source = await readGrabAndGoSource(deliveryDate);
  return buildGrabAndGoProduction(deliveryDate, source.orders, source.catalogue || []);
}
