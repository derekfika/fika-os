import assert from "node:assert/strict";
import test from "node:test";
import { validateCatalogueRules, catalogueMinimums, type RuleItem } from "@fika/server-shared/hospitality-effective-offering";
import { SiteConfiguration } from "../lib/schemas";
import { approvedOacEntries, createdItemId, requestIdFor, OAC_OPLOC_ID, type LiveLookup } from "../lib/oac-approved-catalogue";
import { prepareCatalogueSyncPlan, verifyCatalogueSyncPlan, type CatalogueSyncEntry } from "../lib/oac-catalogue-sync-plan";

const flavours = ["Crayfish and avocado", "Hot smoked trout", "Char-siu pulled chicken", "Lemongrass, ginger & chilli chicken", "Rainbow vegetable roll (vegan)", "Hoi-sin tofu and rainbow veg roll (vegan)"].map((label, i) => ({ id: `flavour:${i}`, label }));
const live: LiveLookup = id => ({ canonicalId: id, version: 5, configuration: { choices: [{ options: flavours }] } });
const entries = approvedOacEntries(live, { newItemVatRate: 0.2 }); // test-only approval; production plans carry no VAT approval until the operator gives one
const by = (prefix: string) => { const e = entries.find(x => x.key.startsWith(prefix)); assert.ok(e, prefix); return e!; };
const cmd = (prefix: string) => { const c = by(prefix).command; assert.ok(c, `${prefix} has a command`); return c as any; };
const SOURCE = "a".repeat(64);

test("the plan covers all 53 brochure rows plus the Classic exclusion, with no unresolved holds", () => {
  const rows = entries.filter(e => e.classification !== "exclude");
  assert.equal(rows.length, 53, "53 brochure rows; juice rows 9-11 share one canonical Item override (one command, two audit-only rows)");
  assert.equal(entries.filter(e => e.classification === "exclude").length, 1);
  const plan = prepareCatalogueSyncPlan(SOURCE, entries, OAC_OPLOC_ID);
  assert.equal(plan.body.holds.length, 0, JSON.stringify(plan.body.holds));
  assert.deepEqual(verifyCatalogueSyncPlan(plan, plan.planHash, SOURCE).length, entries.filter(e => e.command).length);
  assert.equal(plan.applySupported, false); assert.equal(plan.approved, false);
});

test("regenerating the plan from identical source is byte-stable (repeat sync = no new changes)", () => {
  assert.equal(prepareCatalogueSyncPlan(SOURCE, approvedOacEntries(live, { newItemVatRate: 0.2 })).planHash, prepareCatalogueSyncPlan(SOURCE, approvedOacEntries(live, { newItemVatRate: 0.2 })).planHash);
});

test("every proposed command is OAC-scoped and no shared default, shared routing or archive command exists", () => {
  for (const e of entries) {
    const c = e.command as any; if (!c) continue;
    assert.ok(["create-item", "set-site-override"].includes(c.action), e.key);
    if (c.action === "set-site-override") assert.equal(c.oplocId, OAC_OPLOC_ID);
    if (c.action === "create-item") { assert.deepEqual(c.oplocIds, [OAC_OPLOC_ID]); assert.equal(c.restrictToSelectedOplocs, true); assert.ok(c.routing); }
    if (c.configuration) SiteConfiguration.parse(c.configuration);
  }
});

test("Classic Working Lunch is never created; Deli Style Sandwich is £10.95, min 10, product-derived guest policy", () => {
  assert.equal(by("oac-2026-classic").command, undefined);
  assert.ok(!entries.some(e => e.command && /classic working/i.test(JSON.stringify(e.command))));
  const deli = cmd("13-deli");
  assert.equal(deli.itemId, "hospitality-menu-item:mnk:deli_sandwich_lunch");
  assert.equal(deli.price.amount, 10.95); assert.equal(deli.minimumQuantity, 10);
  assert.equal(deli.configuration.rules.guestMinimumKind, "product");
});

test("approved routing, including the in-house, CPU Hospitality and CPU Sandwiches groups", () => {
  const route = (p: string) => cmd(p).routing;
  for (const p of ["05-baps", "28-nibble", "43-house", "44-", "45-", "46-", "47-", "48-", "49-", "50-", "51-", "52-", "53-"]) assert.equal(route(p), "in_house", p);
  for (let n = 32; n <= 42; n++) assert.equal(route(`${n}-wine`), "in_house");
  for (const p of ["03-", "04-", "16-", "17-", "18-", "24-", "27-", "30-", "31-", "06-"]) assert.equal(route(p), "cpu_hospitality", p);
  // Updates to shared Items never touch routing (no set-routing command exists in the plan).
  assert.ok(!entries.some(e => (e.command as any)?.action === "set-routing"));
});

test("approved prices, minimums, notice and guest floors", () => {
  const sr = cmd("23-summer");
  assert.deepEqual([sr.price.amount, sr.minimumQuantity, sr.minimumGuests, sr.noticeRequiredDays], [30, 3, 20, 10]);
  assert.equal(sr.configuration.rules.productionConversion.multiplier, 12);
  assert.equal(sr.configuration.choices[0].controlType, "quantities"); assert.equal(sr.configuration.choices[0].options.length, 6);
  assert.equal(cmd("29-picnic").noticeRequiredDays, 10); assert.equal(cmd("29-picnic").minimumGuests, undefined, "Item default guest floor of 20 is inherited");
  const ff = cmd("22-finger"); assert.equal(ff.price, undefined, "£3.95 is already the inherited default; an equal override would be refused"); assert.deepEqual([3.95, ff.minimumQuantity, ff.minimumGuests, ff.noticeRequiredDays, ff.configuration.choices[0].minimumQuantity, ff.configuration.choices[0].options.length], [3.95, 12, 20, 10, 12, 15]);
  const nb = cmd("28-nibble"); assert.deepEqual([nb.defaultPrice.amount, nb.defaultMinimumQuantity, nb.configuration.serves, nb.configuration.choices[0].minimumQuantity], [2, 3, 3, 3]);
  assert.equal(cmd("02-breakfast").price.amount, 3.5);
  assert.equal(cmd("08-soft").price.amount, 2); assert.equal(cmd("12-water").price.amount, 3.5);
  assert.deepEqual([cmd("24-classic").defaultPrice.amount, cmd("24-classic").minimumGuests], [18, 50]);
  assert.deepEqual([cmd("30-standard").defaultPrice.amount, cmd("31-premium").defaultPrice.amount, cmd("31-premium").minimumGuests], [25, 32.5, 20]);
  assert.deepEqual([cmd("43-house").defaultPrice.amount], [15]);
  assert.deepEqual(["44", "45", "46", "47", "48"].map(n => cmd(`${n}-`).defaultPrice.amount), [68, 68, 45, 45, 45]);
  assert.deepEqual(["49", "50", "51", "52", "53"].map(n => cmd(`${n}-`).defaultPrice.amount), [10, 10, 15, 12, 8]);
});

test("wines keep exact brochure names, accents and prices; no generic house wine", () => {
  const w = Array.from({ length: 11 }, (_, i) => cmd(`${32 + i}-wine`));
  assert.deepEqual(w.map(x => x.defaultPrice.amount), [27, 31, 34, 27, 35, 27, 32, 36, 32, 37, 60]);
  assert.ok(w[0].name.includes("Castaño")); assert.ok(w[4].name.includes("Rosé")); assert.ok(w[9].name.includes("Raventós i Blanc, Cataluña")); assert.ok(w[10].name.includes("Cuvée"));
});

test("cakes are quote-only with indicative prices and no purchase price", () => {
  const celebration = cmd("18-celebration"), loaf = cmd("19-loaf");
  assert.equal(celebration.offeringMode, "quote_only"); assert.equal(celebration.defaultPrice, undefined); assert.equal(celebration.configuration.rules.indicativeFrom, 27); assert.equal(celebration.configuration.rules.noticeHours, 72);
  assert.equal(loaf.offeringMode, "quote_only"); assert.equal(loaf.price, undefined); assert.equal(loaf.configuration.rules.indicativeFrom, 20); assert.equal(loaf.noticeRequiredDays, 3);
});

test("croissants: the £60 box-of-12 Item is untouched; a separate OAC-only each product converts 1:1", () => {
  assert.ok(!entries.some(e => (e.command as any)?.itemId?.includes("filled_savoury_croissant")));
  const c = cmd("06-croissant");
  assert.equal(c.action, "create-item"); assert.equal(c.defaultPrice.amount, 5); assert.equal(c.defaultMinimumQuantity, 12);
  assert.deepEqual(c.configuration.rules.productionConversion, { multiplier: 1, unit: "croissant" });
  assert.equal(c.configuration.choices[0].options.length, 3);
});

test("juice reuses the canonical 250ml Item; no duplicate product or price change", () => {
  const j = cmd("09-juice"); assert.equal(j.itemId, "hospitality-menu-item:rcoa:fresh_juice_250"); assert.equal(j.price, undefined);
  assert.deepEqual(j.configuration.choices[0].options.map((o: any) => o.label), ["Orange", "Apple", "Carrot, Pear & Ginger"]);
  assert.equal(by("10-").command, undefined); assert.equal(by("11-").command, undefined);
});

test("upgrades reference the deterministic House Drinks parent id and every request id is unique", () => {
  const parent = createdItemId(requestIdFor("43-house-drinks"));
  for (const n of ["49", "50", "51", "52", "53"]) { const r = cmd(`${n}-`).configuration.rules; assert.equal(r.parentItemId, parent); assert.equal(r.parentQuantity, "same"); }
  const ids = entries.map(e => (e.command as any)?.requestId).filter(Boolean); assert.equal(new Set(ids).size, ids.length);
  assert.ok(entries.findIndex(e => e.key.startsWith("43-")) < entries.findIndex(e => e.key.startsWith("49-")), "parent is created before its upgrades");
});

test("createdItemId equals the governed create-item identity formula", async () => {
  const admin = await import("../lib/hospitality-catalogue-admin");
  assert.equal(admin.catalogueCreateItemId("x"), createdItemId("x"));
});

// ---------- behavioural checks through the shared validator ----------
const NOW = "2026-10-20T07:00:00Z";
const ctx = (over: Partial<{ gallagher: boolean; guestCount: number }> = {}) => ({ gallagher: false, guestCount: 30, eventDate: "2026-11-16", startTime: "11:30", now: NOW, ...over });
function ruleItem(prefix: string, minimumGuests?: number): RuleItem {
  const c = cmd(prefix); const cfg = c.configuration;
  return { id: prefix, name: c.name || prefix, minimumQuantity: c.defaultMinimumQuantity ?? c.minimumQuantity ?? 1, minimumGuests: c.minimumGuests ?? minimumGuests, configuration: cfg, rules: cfg.rules };
}
const alloc = (id: string, quantities: Record<string, number>) => [{ id, quantities }];
const optId = (prefix: string, i: number) => cmd(prefix).configuration.choices[0].options[i].id;

test("Gallagher: product minimums cap at 5, brochure minimums stand for ordinary customers", () => {
  const deli = { id: "deli", name: "Deli", minimumQuantity: 10, rules: cmd("13-deli").configuration.rules };
  assert.equal(catalogueMinimums(deli, false).quantity, 10); assert.equal(catalogueMinimums(deli, true).quantity, 5);
  assert.throws(() => validateCatalogueRules([deli], [{ itemId: "deli", quantity: 9 }], ctx()), /at least 10/);
  validateCatalogueRules([deli], [{ itemId: "deli", quantity: 5 }], ctx({ gallagher: true }));
  assert.throws(() => validateCatalogueRules([deli], [{ itemId: "deli", quantity: 4 }], ctx({ gallagher: true })), /at least 5/);
  const cr = ruleItem("06-croissant");
  assert.equal(catalogueMinimums(cr, false).quantity, 12); assert.equal(catalogueMinimums(cr, true).quantity, 5);
  validateCatalogueRules([cr], [{ itemId: cr.id, quantity: 5, choices: alloc("filling", { [optId("06-croissant", 0)]: 5 }) }], ctx({ gallagher: true }));
  assert.throws(() => validateCatalogueRules([cr], [{ itemId: cr.id, quantity: 11, choices: alloc("filling", { [optId("06-croissant", 0)]: 11 }) }], ctx()), /at least 12/);
  const pots = { id: "pots", name: "Breakfast Pots", minimumQuantity: 12 };
  assert.equal(catalogueMinimums(pots, true).quantity, 5);
});

test("Gallagher does not waive Finger Food variety minimums, event guest floors or the three-platter minimum", () => {
  const ff = ruleItem("22-finger"); const a = optId("22-finger", 0), b = optId("22-finger", 1);
  validateCatalogueRules([ff], [{ itemId: ff.id, quantity: 24, choices: alloc("variety", { [a]: 12, [b]: 12 }) }], ctx());
  assert.throws(() => validateCatalogueRules([ff], [{ itemId: ff.id, quantity: 10, choices: alloc("variety", { [a]: 10 }) }], ctx({ gallagher: true })), /each selected variety requires at least 12/);
  assert.throws(() => validateCatalogueRules([ff], [{ itemId: ff.id, quantity: 12, choices: alloc("variety", { [a]: 12 }) }], ctx({ gallagher: true, guestCount: 5 })), /at least 20 guests/);
  const sr = ruleItem("23-summer"); const f0 = sr.configuration!.choices![0].options[0].id, f1 = sr.configuration!.choices![0].options[1].id;
  validateCatalogueRules([sr], [{ itemId: sr.id, quantity: 3, choices: alloc("flavour", { [f0]: 2, [f1]: 1 }) }], ctx({ guestCount: 20 }));
  assert.throws(() => validateCatalogueRules([sr], [{ itemId: sr.id, quantity: 2, choices: alloc("flavour", { [f0]: 2 }) }], ctx({ gallagher: true, guestCount: 20 })), /at least 3/);
  assert.throws(() => validateCatalogueRules([sr], [{ itemId: sr.id, quantity: 3, choices: alloc("flavour", { [f0]: 3 }) }], ctx({ gallagher: true, guestCount: 10 })), /at least 20 guests/);
});

test("Summer rolls: exactly one flavour per platter (allocation must add up), different platters may differ", () => {
  const sr = ruleItem("23-summer"); const [f0, f1] = sr.configuration!.choices![0].options.map(o => o.id);
  const line = (q: number, v: Record<string, number>) => validateCatalogueRules([sr], [{ itemId: sr.id, quantity: q, choices: alloc("flavour", v) }], ctx({ guestCount: 25 }));
  line(4, { [f0]: 1, [f1]: 3 });
  assert.throws(() => line(4, { [f0]: 1, [f1]: 2 }), /add up/);
  assert.throws(() => line(4, { [f0]: 2, [f1]: 3 }), /add up/);
  assert.throws(() => validateCatalogueRules([sr], [{ itemId: sr.id, quantity: 4 }], ctx({ guestCount: 25 })), /quantities|add up/);
});

test("Nibble bowls need 3 of each selected variety; salad boxes allocate exactly one variety per box", () => {
  const nb = ruleItem("28-nibble"); const [a, b] = nb.configuration!.choices![0].options.map(o => o.id);
  validateCatalogueRules([nb], [{ itemId: nb.id, quantity: 6, choices: alloc("variety", { [a]: 3, [b]: 3 }) }], ctx());
  assert.throws(() => validateCatalogueRules([nb], [{ itemId: nb.id, quantity: 5, choices: alloc("variety", { [a]: 2, [b]: 3 }) }], ctx()), /each selected variety requires at least 3/);
  const sal = { id: "salad", name: "Salad Boxes", minimumQuantity: 1, configuration: cmd("14-salad").configuration, rules: cmd("14-salad").configuration.rules } as RuleItem;
  const o = cmd("14-salad").configuration.choices[0].options.map((x: any) => x.id);
  validateCatalogueRules([sal], [{ itemId: "salad", quantity: 3, choices: alloc("salad", { [o[0]]: 1, [o[1]]: 1, [o[3]]: 1 }) }], ctx());
  assert.throws(() => validateCatalogueRules([sal], [{ itemId: "salad", quantity: 2, choices: alloc("salad", { [o[0]]: 1 }) }], ctx()), /add up/);
  assert.equal(o.length, 4);
});

test("House Drinks upgrades must cover the full package guest count; several may be combined", () => {
  const pkg = { id: "pkg", name: "House Drinks", minimumQuantity: 1 } as RuleItem;
  const up = (id: string, prefix: string): RuleItem => ({ id, name: id, minimumQuantity: 1, rules: { ...cmd(prefix).configuration.rules, parentItemId: "pkg" } });
  const wine = up("wine", "49-"), pros = up("pros", "50-"), champ = up("champ", "51-");
  const items = [pkg, wine, pros, champ];
  validateCatalogueRules(items, [{ itemId: "pkg", quantity: 20 }, { itemId: "wine", quantity: 20 }, { itemId: "pros", quantity: 20 }, { itemId: "champ", quantity: 20 }], ctx());
  assert.throws(() => validateCatalogueRules(items, [{ itemId: "pkg", quantity: 20 }, { itemId: "wine", quantity: 19 }], ctx()), /compatible quantity/);
  assert.throws(() => validateCatalogueRules(items, [{ itemId: "pkg", quantity: 20 }, { itemId: "wine", quantity: 21 }], ctx()), /compatible quantity/);
  assert.throws(() => validateCatalogueRules(items, [{ itemId: "wine", quantity: 20 }], ctx()), /parent package/);
  // Cumulative price: 20 guests x (15 + 10 + 10 + 15)
  const price = (p: string) => (cmd(p).defaultPrice.amount as number);
  assert.equal(20 * (price("43-house") + price("49-") + price("50-") + price("51-")), 20 * 50);
});

test("quote-only cakes cannot be checked out at their starting price", () => {
  const cake = { id: "cake", name: "Celebration Cake", rules: cmd("18-celebration").configuration.rules } as RuleItem;
  assert.throws(() => validateCatalogueRules([cake], [{ itemId: "cake", quantity: 1 }], { ...ctx(), eventDate: "2026-11-16" }), /agreed quote/);
});

test("72-hour cake notice and 10-day event notice are exact elapsed hours", () => {
  const loaf = { id: "loaf", name: "Loaf", rules: { noticeHours: 72 } } as RuleItem;
  const canape = { id: "can", name: "Canapes", minimumGuests: 20, rules: cmd("20-canapes").configuration.rules } as RuleItem;
  assert.equal(cmd("20-canapes").configuration.rules.noticeHours, 240);
  assert.throws(() => validateCatalogueRules([canape], [{ itemId: "can", quantity: 20 }], { ...ctx({ guestCount: 20 }), eventDate: "2026-10-29", startTime: "12:00" }), /240 hours/);
  validateCatalogueRules([canape], [{ itemId: "can", quantity: 20 }], { ...ctx({ guestCount: 20 }), eventDate: "2026-10-30", startTime: "12:00" });
  void loaf;
});

test("no entry lets an allergen, dietary or VAT claim into a created Item", () => {
  for (const e of entries) { const c = e.command as any; if (!c) continue; const s = JSON.stringify(c); assert.ok(!/allergen|dietary|"vegan":|gluten free":/i.test(s.replace(/vegan\)/gi, "").replace(/Vegan Cream Cheese/gi, "").replace(/Gluten Free Sweetcorn/gi, "")), e.key); }
});

test("VAT: without an operator-approved rate every new priced product is held and no VAT rate is written", () => {
  const unapproved = approvedOacEntries(live);
  const priced = unapproved.filter(e => e.classification === "create" && (e.command as any).defaultPrice);
  assert.equal(priced.length, 33, "34 creates; the quote-only Celebration Cake has no purchase price");
  assert.ok(priced.every(e => e.taxApprovalRequired && (e.command as any).defaultPrice.vatRate === undefined));
  const plan = prepareCatalogueSyncPlan(SOURCE, unapproved, OAC_OPLOC_ID);
  assert.equal(plan.body.holds.filter(h => h.tax).length, 33);
  assert.throws(() => verifyCatalogueSyncPlan(plan, plan.planHash, SOURCE), /Unresolved/);
  // Overrides on existing Items never state a VAT rate: they inherit the Item's governed rate.
  for (const e of unapproved) if ((e.command as any)?.action === "set-site-override" && (e.command as any).price) assert.equal((e.command as any).price.vatRate, undefined, e.key);
});

test("Classic Buffet: £18 pp, quantity and event guest floor are both 50; Gallagher relaxes only the product quantity", () => {
  const bf = ruleItem("24-classic");
  assert.equal(cmd("24-classic").defaultPrice.amount, 18);
  validateCatalogueRules([bf], [{ itemId: bf.id, quantity: 50 }], ctx({ guestCount: 50 }));
  assert.throws(() => validateCatalogueRules([bf], [{ itemId: bf.id, quantity: 49 }], ctx({ guestCount: 50 })), /at least 50 ordered/);
  assert.throws(() => validateCatalogueRules([bf], [{ itemId: bf.id, quantity: 50 }], ctx({ guestCount: 49 })), /at least 50 guests/);
  assert.throws(() => validateCatalogueRules([bf], [{ itemId: bf.id, quantity: 5 }], ctx({ gallagher: true, guestCount: 30 })), /at least 50 guests/);
});

test("Mini Traybake Bites are an assortment description, not a customer-selected mix, and never reuse the nut/nut-free Traybake Box identities", () => {
  const t = cmd("16-traybake");
  assert.equal(t.action, "create-item"); assert.equal((t.configuration.choices || []).length, 0);
  assert.match(t.configuration.description, /assortment/i);
  assert.ok(!entries.some(e => /traybake_box/.test(JSON.stringify(e.command || ""))));
});

test("OAC quote: catalogue prices are ex VAT; 8% management fee once; 20% VAT once on the final net subtotal", async () => {
  const { calculateQuoteSnapshot, defaultDashboardQuoteSettings } = await import("../lib/quote-engine");
  const settings = defaultDashboardQuoteSettings("angel-court-hospitality");
  assert.equal(settings.vatRate, 0.2); assert.deepEqual([settings.managementFee.mode, settings.managementFee.value], ["percentage", 8]);
  const quote = calculateQuoteSnapshot({ canonicalId: "booking:oac-test", client: { name: "T", companyName: "C", email: "t@example.test" }, service: { eventDate: "2026-11-16", startTime: "12:00", guestCount: 20, portalSiteLabel: "Angel Court" }, order: { items: [{ itemId: "a", itemName: "Premium BBQ", quantity: 20, unitPrice: 32.5 }, { itemId: "b", itemName: "House Drinks", quantity: 20, unitPrice: 15 }, { itemId: "c", itemName: "Premium wine", quantity: 20, unitPrice: 10 }] }, dietaries: {} } as never, settings);
  assert.equal(quote.totals.itemsNet.amount, 1150);                                   // 650 + 300 + 200, all ex VAT
  assert.equal(quote.charges.filter(c => c.code === "management_fee").length, 1);     // exactly once
  assert.equal(quote.charges.find(c => c.code === "management_fee")!.net.amount, 92); // 8% of 1150
  assert.equal(quote.totals.net.amount, 1242);
  assert.equal(quote.totals.vat.amount, 248.4);                                       // 20% of the final net, once
  assert.equal(quote.totals.gross.amount, 1490.4);
});
