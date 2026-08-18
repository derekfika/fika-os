/* eslint-disable @typescript-eslint/no-explicit-any */
import { squareFixture } from "@/fixtures/square";
import type { ReportSyncProgress } from "../sync-service";

async function squareRequest(path: string, init?: RequestInit, retry = true) {
  const token = process.env.SQUARE_ACCESS_TOKEN, version = process.env.SQUARE_API_VERSION, base = process.env.SQUARE_API_BASE_URL || "https://connect.squareup.com";
  if (!token || !version || !base.startsWith("https://")) throw new Error("Square live-local credentials or API version are incomplete.");
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}`, "Square-Version": version, "content-type": "application/json", ...(init?.headers || {}) }, cache: "no-store" });
  if (response.status === 429 && retry) { await new Promise(resolve => setTimeout(resolve, 500)); return squareRequest(path, init, false); }
  if (!response.ok) throw Object.assign(new Error("Square returned a safe connector error."), { status: response.status });
  return response.json() as Promise<Record<string, any>>;
}

export async function fetchSquare(fullReconciliation = false, report?: ReportSyncProgress, objectTypes: string[] = ["ITEM", "CATEGORY", "TAX", "MODIFIER_LIST"]) {
  const mode = process.env.SQUARE_MODE === "live-local" ? "live-local" : "fixture";
  if (mode === "fixture") { await report?.({ phase: "Reading fixture", message: "Loading the safe synthetic Square catalogue.", percent: 45 }); return { mode, ...squareFixture, fullReconciliation }; }
  await report?.({ phase: "Connecting to Square", message: "Requesting locations through the read-only connector.", percent: 5 });
  const locationData = await squareRequest("/v2/locations");
  await report?.({ phase: "Retrieving catalogue", message: `${(locationData.locations || []).length} Square locations received. Catalogue pagination has started.`, completed: 0 });
  const objects: Record<string, any>[] = []; let cursor = "", page = 0; const seenCursors = new Set<string>();
  do { const data = await squareRequest("/v2/catalog/search", { method: "POST", body: JSON.stringify({ object_types: objectTypes, include_deleted_objects: true, ...(cursor ? { cursor } : {}) }) }); page += 1; objects.push(...(data.objects || [])); await report?.({ phase: "Retrieving catalogue", message: `Square catalogue page ${page} received; ${objects.length} source objects collected.`, completed: objects.length }); const nextCursor = data.cursor || ""; if (nextCursor && seenCursors.has(nextCursor)) throw new Error("Square returned a repeated pagination cursor; sync stopped safely."); if (nextCursor) seenCursors.add(nextCursor); cursor = nextCursor; } while (cursor);
  await report?.({ phase: "Transforming catalogue", message: `${objects.length} Square source objects collected across ${page} page(s). Building clean Till Item records and relationships.`, completed: objects.length, total: objects.length || 1, percent: 82 });
  return { mode, locations: locationData.locations || [], objects, fullReconciliation };
}

export function squareObjects(data: Awaited<ReturnType<typeof fetchSquare>>) {
  const allObjects = data.objects as Record<string, any>[];
  const taxById = new Map(allObjects.filter(o => o.type === "TAX").map(o => [o.id, { externalId: o.id, name: o.tax_data?.name || "", percentage: o.tax_data?.percentage, inclusionType: o.tax_data?.inclusion_type, enabled: o.tax_data?.enabled, calculationPhase: o.tax_data?.calculation_phase }]));
  const modifierById = new Map(allObjects.filter(o => o.type === "MODIFIER_LIST").map(o => [o.id, { externalId: o.id, name: o.modifier_list_data?.name || "", selectionType: o.modifier_list_data?.selection_type, modifierCount: (o.modifier_list_data?.modifiers || []).length }]));
  const categories = allObjects.filter(o => o.type === "CATEGORY").map(o => ({ externalId: o.id, name: o.category_data?.name || "", categoryType: o.category_data?.category_type, parentCategoryExternalId: o.category_data?.parent_category?.id, ordinal: o.category_data?.ordinal, providerVersion: String(o.version || ""), providerUpdatedAt: o.updated_at, active: !o.is_deleted, sourceMetadata: squareSourceMetadata(o) }));
  const categoryById = new Map(categories.map(category => [category.externalId, { externalId: category.externalId, name: category.name, categoryType: category.categoryType }]));
  const locationById = new Map((data.locations as Record<string, any>[]).map(location => [location.id, { externalId: location.id, name: location.name || "", status: location.status || "" }]));
  const items = allObjects.filter(o => o.type === "ITEM").map(o => { const item = o.item_data || {}; const taxIds = item.tax_ids || []; const modifierListIds = (item.modifier_list_info || []).map((x: any) => x.modifier_list_id); const categoryIds = [...new Set([item.category_id, ...(item.categories || []).map((category: any) => category.id)].filter(Boolean))] as string[]; return { externalId: o.id, name: item.name || "", description: item.description_plaintext || item.description, abbreviation: item.abbreviation, productType: item.product_type, categoryExternalId: item.category_id, categoryExternalIds: categoryIds, categoryReferences: categoryIds.map(id => categoryById.get(id) || { externalId: id, name: "", categoryType: undefined }), providerVersion: String(o.version || ""), providerUpdatedAt: o.updated_at, active: !o.is_deleted, taxIds, taxReferences: taxIds.map((id: string) => taxById.get(id) || { externalId: id }), modifierListIds, modifierListReferences: modifierListIds.map((id: string) => modifierById.get(id) || { externalId: id }), availableOnline: item.available_online, availableForPickup: item.available_for_pickup, availableElectronically: item.available_electronically, imageIds: item.image_ids || [], variationCount: (item.variations || []).length, locationAvailability: squareLocationAvailability(o, locationById), sourceMetadata: squareSourceMetadata(o) }; });
  const variations = allObjects.filter(o => o.type === "ITEM").flatMap(o => (o.item_data?.variations || []).map((v: any) => ({ externalId: v.id, itemExternalId: o.id, name: v.item_variation_data?.name || "", sku: v.item_variation_data?.sku, pricingType: v.item_variation_data?.pricing_type, providerVersion: String(v.version || ""), providerUpdatedAt: v.updated_at, active: !v.is_deleted, basePrice: v.item_variation_data?.price_money, locationPrices: (v.item_variation_data?.location_overrides || []).map((p: any) => ({ locationExternalId: p.location_id, locationName: locationById.get(p.location_id)?.name || "", ...p.price_money, soldOut: p.sold_out, trackInventory: p.track_inventory, inventoryAlertType: p.inventory_alert_type, inventoryAlertThreshold: p.inventory_alert_threshold })), presentAtAllLocations: v.present_at_all_locations, locationIds: v.present_at_location_ids || [], absentAtLocationIds: v.absent_at_location_ids || [], locationAvailability: squareLocationAvailability(v, locationById), sellable: v.item_variation_data?.sellable, stockable: v.item_variation_data?.stockable, serviceDuration: v.item_variation_data?.service_duration, measurementUnitExternalId: v.item_variation_data?.measurement_unit_id, imageIds: v.item_variation_data?.image_ids || [], sourceMetadata: squareSourceMetadata(v) })));
  const locations = (data.locations as Record<string, any>[]).map(o => ({ externalId: o.id, name: o.name || "", status: o.status || "", address: o.address ? Object.values(o.address).filter(Boolean).join(", ") : undefined, businessName: o.business_name, description: o.description, timezone: o.timezone, currency: o.currency, country: o.country, capabilities: o.capabilities || [], active: o.status !== "INACTIVE", providerVersion: o.updated_at || "", providerUpdatedAt: o.updated_at, sourceMetadata: { providerObjectType: "LOCATION", providerUpdatedAt: o.updated_at, status: o.status } }));
  return { locations, categories, items, variations, supportingObjects: allObjects.filter(o => ["TAX", "MODIFIER_LIST"].includes(o.type)) };
}

function squareSourceMetadata(object: Record<string, any>) {
  return { providerObjectType: object.type, providerUpdatedAt: object.updated_at, isDeleted: Boolean(object.is_deleted), presentAtAllLocations: object.present_at_all_locations, presentAtLocationIds: object.present_at_location_ids || [], absentAtLocationIds: object.absent_at_location_ids || [] };
}

function squareLocationAvailability(object: Record<string, any>, locations: Map<string, { externalId: string; name: string; status: string }>) {
  const presentIds = object.present_at_location_ids || [];
  const absentIds = object.absent_at_location_ids || [];
  return { presentAtAllLocations: Boolean(object.present_at_all_locations), presentAtLocations: presentIds.map((id: string) => locations.get(id) || { externalId: id, name: "", status: "" }), absentAtLocations: absentIds.map((id: string) => locations.get(id) || { externalId: id, name: "", status: "" }) };
}
