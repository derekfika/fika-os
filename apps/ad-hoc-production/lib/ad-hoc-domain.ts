import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenKey, type CanonicalAllergenMap, normaliseOperationalAllergens } from "../../shared/allergen-contract";

export type AdHocStatus = "DRAFT" | "REVIEWED" | "QUOTED" | "SENT_TO_CPU" | "COMPLETED" | "CANCELLED";
export type Destination = { mode: "oploc" | "one_off"; oplocId?: string; label: string; address: string; room?: string; deliveryInstructions?: string; contact?: string; identity: string };
export type AdHocLine = { id: string; title: string; quantity: number; unit: string; unitPrice?: number; allergens: CanonicalAllergenMap; mayContainNotes?: string; productionNotes?: string; sortOrder: number; canonicalDishId?: string };
export type QuoteRevision = { id: string; revision: number; generatedAt: string; generatedBy: string; lines: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; deliveryCharge: number; subtotal: number; vatRate: number; vat: number; total: number; stale?: boolean; pdfStatus: "pending" | "saved" | "failed"; driveFileId?: string; driveUrl?: string };
export type AdHocRequest = { id: string; reference: string; version: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; title: string; clientName: string; contactName?: string; contactEmail?: string; contactPhone?: string; internalReference?: string; notes?: string; serviceDate: string; requiredReadyTime: string; serviceWindowEnd?: string; pax?: number; priority: "normal" | "high" | "urgent"; deliveryRequired: boolean; quoteRequired: boolean; quoteBypassReason?: string; deliveryCharge: number; vatRate: number; destination: Destination; lines: AdHocLine[]; status: AdHocStatus; quoteRevisions: QuoteRevision[]; currentQuoteRevisionId?: string; generatedMenu?: { version: number; generatedAt: string; driveUrl?: string; stale?: boolean; html: string }; productionOrderId?: string; productionOrderVersion?: number; audit: Array<{ action: string; at: string; by: string; reason?: string; version: number }> };

export const blankAllergens = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, undefined]).filter(([, value]) => value)) as CanonicalAllergenMap;
export function lineAllergensComplete(line: AdHocLine) { return Boolean(line.title.trim()) && CANONICAL_ALLERGEN_KEYS.every(key => ["clear", "contains", "may_contain"].includes(line.allergens[key])); }
export function reviewBlockers(request: Pick<AdHocRequest, "serviceDate" | "requiredReadyTime" | "destination" | "lines" | "quoteRequired"> & Pick<AdHocRequest, "quoteBypassReason">) {
  const blockers: string[] = [];
  if (!request.serviceDate) blockers.push("Add a service date");
  if (!request.requiredReadyTime) blockers.push("Add a required-ready time");
  if (!request.destination.label.trim() || !request.destination.address.trim()) blockers.push("Add a meaningful delivery address or destination");
  if (!request.lines.length) blockers.push("Add at least one production line");
  request.lines.forEach(line => { if (!line.title.trim()) blockers.push("Name every menu item"); if (!(line.quantity > 0)) blockers.push(`Add a positive quantity for ${line.title || "the menu item"}`); if (!line.unit.trim()) blockers.push(`Choose a unit for ${line.title || "the menu item"}`); if (!lineAllergensComplete(line)) blockers.push(`Confirm allergens for ${line.title || "the menu item"}`); if (request.quoteRequired && typeof line.unitPrice !== "number") blockers.push(`Add a price for ${line.title || "the menu item"}`); });
  if (request.quoteRequired === false && !request.quoteBypassReason?.trim()) blockers.push("Record why a quote is not required");
  return [...new Set(blockers)];
}
export function normaliseLine(line: Omit<AdHocLine, "allergens"> & { allergens?: Record<string, unknown> }): AdHocLine { return { ...line, allergens: normaliseOperationalAllergens(line.allergens) }; }
export function quoteFor(request: Pick<AdHocRequest, "lines" | "deliveryCharge" | "vatRate" | "version">, by: string, now = new Date().toISOString()): QuoteRevision {
  const lines = request.lines.map(line => { const unitPrice = Number(line.unitPrice || 0); return { description: line.title, quantity: line.quantity, unitPrice, total: Number((unitPrice * line.quantity).toFixed(2)) }; });
  const subtotal = Number((lines.reduce((sum, line) => sum + line.total, 0) + Number(request.deliveryCharge || 0)).toFixed(2)); const vat = Number((subtotal * Number(request.vatRate || 0)).toFixed(2));
  return { id: `adhoc-quote:${request.version}:${crypto.randomUUID()}`, revision: 1, generatedAt: now, generatedBy: by, lines, deliveryCharge: request.deliveryCharge, subtotal, vatRate: request.vatRate, vat, total: Number((subtotal + vat).toFixed(2)), pdfStatus: "pending" };
}
export function menuHtml(request: Pick<AdHocRequest, "title" | "clientName" | "serviceDate" | "lines">) { return `<!doctype html><html><body style="font-family:Arial;color:#24115c;max-width:760px;margin:40px auto"><h1 style="color:#5135c9">FIKA</h1><p>${request.serviceDate}</p><h2>${request.title}</h2><p>${request.clientName}</p><hr/>${request.lines.map(line => `<h3>${line.title}</h3><p>${line.quantity} ${line.unit}</p>`).join("")}</body></html>`; }
