/* Deterministic development-fixture converter. It reads the legacy source; it never seeds or publishes Canon. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const sourcePath = path.resolve(root, "sites/mnk/booking-platform/01_MenuData.js");
const outputPath = path.resolve(here, "../fixtures/mnk-legacy-menu-import.candidates.json");
const fixtureConfigPath = path.resolve(here, "../fixtures/mnk-legacy-menu-import.config.fixture.json");
const stamp = "2026-07-30T00:00:00.000Z";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
const id = (type, sourceKey) => `${type}:${sourceKey}`;

export function readLegacyMnkMenu(file = sourcePath) {
  const sandbox = { globalThis: {} }; vm.createContext(sandbox);
  vm.runInContext(`${fs.readFileSync(file, "utf8")}\nglobalThis.__menu = MENU_SCHEMA;`, sandbox, { filename: file });
  return JSON.parse(JSON.stringify(sandbox.globalThis.__menu));
}

export function convertLegacyMnkMenu(records, config) {
  if (!config?.oplocId?.startsWith("oploc:")) throw Error("mnkMenuImport.oplocId must be an explicit canonical OPLOC ID; display-name lookup is prohibited.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.priceEffectiveFrom || "")) throw Error("mnkMenuImport.priceEffectiveFrom is required; the source file does not establish price effective dates.");
  const audit = (entityType, canonicalId) => ({ schemaVersion: "0.1.0", version: 1, createdAt: stamp, createdBy: "migration:mnk-menu-source", updatedAt: stamp, updatedBy: "migration:mnk-menu-source", active: true, externalIdentities: [], provenanceIds: [`source:mnk-menu:${canonicalId.split(":").at(-1)}`], ownership: { providerOwned: { sourceFile: "sites/mnk/booking-platform/01_MenuData.js" }, fikaOwned: {} }, entityType, canonicalId });
  const items = []; const offerings = []; const prices = []; const candidates = [];
  for (const legacy of records) {
    const itemId = id("hospitality-menu-item", `mnk:${legacy.id}`); const offeringId = id("hospitality-menu-offering", `mnk:${hash(`${config.oplocId}:${legacy.id}`)}`); const quoteOnly = legacy.id === "bespoke_event";
    const item = { ...audit("Hospitality Menu Item", itemId), name: legacy.name, ...(legacy.description ? { description: legacy.description } : {}), category: legacy.category, lifecycleState: "active", dietaryInformation: legacy.dietaryTags, allergenInformation: legacy.allergens, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: legacy.id, sourceVersion: "01_MenuData.js" }] };
    const offering = { ...audit("Hospitality Menu Offering", offeringId), hospitalityMenuItemId: itemId, oplocId: config.oplocId, offeringMode: quoteOnly ? "quote_only" : "standard", lifecycleState: legacy.available ? "active" : "archived", ...(legacy.minimumQuantity ? { minimumQuantity: legacy.minimumQuantity } : {}), ...(legacy.minimumGuests ? { minimumGuests: legacy.minimumGuests } : {}), ...(legacy.noticeRequiredDays !== null ? { noticeRequiredDays: legacy.noticeRequiredDays } : {}), configuration: { servingInfo: legacy.servingInfo, serves: legacy.serves, suggestionType: legacy.suggestionType, suggestionLabel: legacy.suggestionLabel, suggestionUnit: legacy.suggestionUnit, sortOrder: legacy.sortOrder, choices: legacy.choices.map(group => ({ id: group.id, label: group.label, controlType: group.type, required: group.required, options: group.options.map(option => ({ id: `${group.id}:${String(option).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, label: option })) })) } };
    items.push(item); offerings.push(offering);
    if (!quoteOnly) prices.push({ ...audit("Hospitality Menu Price", id("hospitality-menu-price", `mnk:${hash(`${offeringId}:${config.priceEffectiveFrom}`)}`)), hospitalityMenuOfferingId: offeringId, amount: legacy.unitPrice, currency: "GBP", vatRate: config.vatRate, effectiveFrom: config.priceEffectiveFrom, lifecycleState: legacy.available ? "active" : "archived" });
    candidates.push({ sourceKey: legacy.id, sourceEvidence: { file: "sites/mnk/booking-platform/01_MenuData.js", legacyId: legacy.id }, itemId, offeringId, ...(quoteOnly ? { reviewOutcome: "quote_only", priceId: null, note: "Legacy zero is not a commercial price." } : { reviewOutcome: "standard", priceId: prices.at(-1).canonicalId }), status: "draft-review-candidate" });
  }
  return { contractVersion: "fika.mnk-legacy-menu-import.candidates.v1", generatedAt: stamp, source: { path: "sites/mnk/booking-platform/01_MenuData.js", recordCount: records.length, sourceHash: hash(JSON.stringify(records)) }, configuration: { oplocId: config.oplocId, priceEffectiveFrom: config.priceEffectiveFrom, vatRate: config.vatRate, configuredAsDevelopmentFixture: Boolean(config.configuredAsDevelopmentFixture) }, items, offerings, prices, candidates, report: { standardOfferings: offerings.filter(x => x.offeringMode === "standard").length, quoteOnlyOfferings: offerings.filter(x => x.offeringMode === "quote_only").length, unavailableSourceFields: ["price effective date", "OPLOC canonical ID", "operational-area scope", "VAT treatment confirmation"], foodSafetyNote: "dietaryInformation and allergenInformation are retained exactly as empty source arrays where empty; descriptions were not inferred." } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2] || fixtureConfigPath, "utf8"));
  const output = convertLegacyMnkMenu(readLegacyMnkMenu(), config);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`Generated ${output.items.length} Item, ${output.offerings.length} Offering and ${output.prices.length} Price candidates at ${path.relative(root, outputPath)}\n`);
}
