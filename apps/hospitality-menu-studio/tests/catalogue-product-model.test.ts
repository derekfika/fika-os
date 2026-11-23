import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductCommand,
  currentRoute,
  initialProductCreation,
  productDetails,
  productReceipt,
  updateProductCommand,
  type ProductCommand,
  type ProductEditorRow,
} from "../components/catalogue-product-model";

const sites = [
  { oplocId: "oploc-fika-town", label: "Fictional Town", active: true },
  { oplocId: "oploc-fika-closed", label: "Closed Site", active: false },
];
const row: ProductEditorRow = {
  itemId: "hospitality-menu-item:fictional-canapes",
  version: 4,
  name: "Fictional Canapés",
  category: "Canapés",
  description: "A selection of small bites",
  status: "active",
  routing: { state: "cpu_hospitality", version: 2 },
  defaultPrice: { amount: 8.5, vatRate: 0.075, effectiveFrom: "2026-11-23" },
  defaultMinimumQuantity: 6,
  defaultMode: "standard",
};

test("creates a standard product with stable site identities, explicit route and replayable request identity", () => {
  const details = {
    ...productDetails(null),
    name: " Fictional Finger Food ",
    category: " Finger Food ",
    price: "12.50",
    vat: "20",
    minimum: "2",
  };
  const creation = {
    ...initialProductCreation(sites),
    route: "cpu_hospitality" as const,
    restrictToSites: true,
  };
  const command = createProductCommand(
    details,
    creation,
    sites,
    "request-uuid-1234",
  );
  assert.deepEqual(command, {
    action: "create-item",
    requestId: "request-uuid-1234",
    name: "Fictional Finger Food",
    category: "Finger Food",
    routing: "cpu_hospitality",
    oplocIds: ["oploc-fika-town"],
    restrictToSelectedOplocs: true,
    defaultMinimumQuantity: 2,
    defaultPrice: { amount: 12.5, vatRate: 0.2 },
  });
  assert.deepEqual(
    createProductCommand(details, creation, sites, command.requestId),
    command,
  );
  assert.throws(
    () =>
      createProductCommand(
        details,
        { ...creation, siteIds: ["oploc-fika-closed"] },
        sites,
        command.requestId,
      ),
    /active sites/,
  );
  assert.throws(
    () =>
      createProductCommand(
        { ...details, price: "4.555" },
        creation,
        sites,
        command.requestId,
      ),
    /two decimal places/,
  );
  assert.throws(
    () =>
      createProductCommand(
        { ...details, vat: "110" },
        creation,
        sites,
        command.requestId,
      ),
    /between 0 and 100/,
  );
});

test("quote-only creation preserves selling and kitchen quantities without a purchase price", () => {
  const details = {
    ...productDetails(null),
    name: "Fictional Finger Food",
    category: "Finger Food",
    price: "19.50",
  };
  const creation = {
    ...initialProductCreation(sites),
    route: "in_house" as const,
    mode: "quote_only" as const,
    indicativeFrom: "18",
    minimumGuests: "12",
    noticeDays: "0",
    salesUnit: "Tray",
    productionUnit: "piece",
    productionMultiplier: "24",
  };
  const command = createProductCommand(
    details,
    creation,
    sites,
    "request-uuid-1234",
  );
  assert.equal(command.offeringMode, "quote_only");
  assert.equal(command.defaultPrice, undefined);
  assert.equal(command.minimumGuests, 12);
  assert.equal(command.noticeRequiredDays, 0);
  assert.deepEqual(command.configuration, {
    rules: {
      salesUnit: "Tray",
      productionConversion: { multiplier: 24, unit: "piece" },
      indicativeFrom: 18,
    },
  });
  assert.throws(
    () =>
      createProductCommand(
        details,
        { ...creation, salesUnit: "" },
        sites,
        command.requestId,
      ),
    /selling unit/,
  );
  assert.throws(
    () =>
      createProductCommand(
        details,
        { ...creation, productionMultiplier: "0" },
        sites,
        command.requestId,
      ),
    /greater than 0/,
  );
});

test("updates product and price atomically with the current Item version and carries through unchanged VAT", () => {
  const details = productDetails(row);
  assert.equal(updateProductCommand(details, row), null);
  assert.equal(
    updateProductCommand(
      { ...details, price: "8.50", minimum: "06", vat: "7.50" },
      row,
    ),
    null,
  );
  assert.deepEqual(
    updateProductCommand(
      { ...details, description: "", price: "9.25", minimum: "" },
      row,
    ),
    {
      action: "update-item",
      itemId: row.itemId,
      expectedVersion: 4,
      name: row.name,
      category: row.category,
      defaultMinimumQuantity: null,
      defaultPrice: { amount: 9.25, vatRate: 0.075 },
    },
  );
  const onlyVat = updateProductCommand({ ...details, vat: "0" }, row);
  assert.deepEqual(onlyVat?.defaultPrice, { amount: 8.5, vatRate: 0 });
  assert.equal(
    updateProductCommand({ ...details, name: "New name" }, row)?.defaultPrice,
    undefined,
  );
  assert.throws(
    () => updateProductCommand({ ...details, price: "" }, row),
    /cannot be cleared/,
  );
  assert.throws(
    () => updateProductCommand({ ...details, minimum: "1.5" }, row),
    /whole number/,
  );
});

test("confirmed standard-site pricing remains editable while an unknown product mode blocks price changes", () => {
  const quote: ProductEditorRow = {
    ...row,
    defaultMode: "quote_only",
    defaultPrice: undefined,
  };
  assert.deepEqual(
    updateProductCommand({ ...productDetails(quote), price: "9" }, quote)
      ?.defaultPrice,
    { amount: 9, vatRate: 0.2 },
  );
  const legacy = { ...row, defaultMode: undefined };
  assert.throws(
    () =>
      updateProductCommand({ ...productDetails(legacy), price: "9" }, legacy),
    /booking mode/,
  );
  assert.equal(
    updateProductCommand({ ...productDetails(legacy), name: "Updated" }, legacy)
      ?.defaultPrice,
    undefined,
  );
  assert.equal(
    currentRoute({
      ...row,
      routing: { state: "routing_required", version: 0 },
    }),
    "",
  );
});

test("accepts only a response acknowledging the requested Item and version, even when its package is stale", () => {
  const archive = {
    action: "set-item-status",
    status: "archived",
    itemId: row.itemId,
    expectedVersion: 4,
  } satisfies ProductCommand;
  const response = {
    message: "Archived",
    package: "stale",
    rows: [{ ...row, version: 5, status: "archived" }],
  };
  assert.deepEqual(productReceipt(response, archive), response);
  assert.equal(productReceipt({ ...response, rows: [] }, archive), null);
  assert.equal(
    productReceipt(
      {
        ...response,
        rows: [
          { ...row, version: 5, status: "archived", itemId: "another-item" },
        ],
      },
      archive,
    ),
    null,
  );
  assert.equal(
    productReceipt(
      { ...response, rows: [{ ...row, status: "archived" }] },
      archive,
    ),
    null,
  );
  assert.equal(
    productReceipt({ ...response, package: "unknown" }, archive),
    null,
  );
  assert.equal(
    productReceipt({ ...response, rows: [{ ...row, version: 5 }] }, archive),
    null,
  );

  const route = {
    action: "set-routing",
    itemId: row.itemId,
    routing: "in_house",
    expectedRoutingVersion: 2,
  } satisfies ProductCommand;
  const routed = {
    message: "Routing saved",
    package: "published",
    rows: [{ ...row, routing: { state: "in_house", version: 3 } }],
  };
  assert.deepEqual(productReceipt(routed, route), routed);
  assert.equal(productReceipt({ ...routed, rows: [row] }, route), null);
});
