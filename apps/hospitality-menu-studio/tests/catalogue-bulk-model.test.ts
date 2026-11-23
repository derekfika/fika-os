import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, importRows, exVat, categoryEffects } from "../components/catalogue-bulk-model";
import type { CataloguePayload, CatalogueRow } from "../components/catalogue-wire";
test("CSV handles escaped quotes, embedded separators and line breaks without silently truncating", () => {
  assert.deepEqual(parseDelimited('name,category,price\r\n"Tea, hot",Drinks,"12"\r\n"Cake ""special""\nlarge",Dessert,5', ","), [["name", "category", "price"], ["Tea, hot", "Drinks", "12"], ['Cake "special"\nlarge', "Dessert", "5"]]);
  assert.throws(() => parseDelimited('"unclosed', ","));
  assert.throws(() => importRows(Array(51).fill("A,B,1,20,,in_house").join("\n"), ",", () => "id"));
});
test("VAT is converted from percentage and rejects missing or invalid inputs", () => {
  assert.equal(exVat("12", "20"), 10); assert.equal(exVat("10", "0"), 10); assert.equal(exVat("", "20"), null); assert.equal(exVat("10", "101"), null);
});
test("category review holds unmapped sites and identifies changed service visibility", () => {
  const payload = { oplocs: [{oplocId: "site", label: "Site", active: true}], serviceLayout: { company: { version: 1, services: { breakfast: { categories: ["Old"] }, lunch: { categories: ["New"] } } }, sites: {}, vocabulary: { catalogueCategories: [], seedCategories: [] } } } as unknown as CataloguePayload;
  const rows = [{ name: "Product", category: "Old", availableAt: ["site"] }] as CatalogueRow[];
  assert.deepEqual(categoryEffects(payload, rows, "New"), { safe: true, changes: ["Product · Site: breakfast → lunch"] });
  assert.equal(categoryEffects(payload, rows, "Missing").safe, false);
  assert.equal(categoryEffects({...payload, serviceLayout: undefined}, rows, "New").safe, false);
});
