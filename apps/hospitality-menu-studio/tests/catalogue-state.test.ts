import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogueReceipt,
  CatalogueCommandError,
  catalogueReceipt,
  requestCatalogueCommand,
} from "../components/catalogue-state";
import type {
  CataloguePayload,
  CatalogueRow,
} from "../components/catalogue-wire";

const row: CatalogueRow = {
  itemId: "fixture-product",
  version: 3,
  name: "Fictional Finger Food",
  category: "Finger Food",
  description: "",
  status: "active",
  defaultMode: "standard",
  routing: {
    state: "cpu_hospitality",
    version: 2,
    workstreams: ["hospitality"],
  },
  offerings: [],
  availableAt: ["fictional-site"],
  unavailableAt: [],
  overrideCount: 0,
  needsReview: [],
  sourceIds: [],
  providerMappings: [],
  dietaryInformation: [],
  allergenInformation: [],
  priceMigration: { status: "not_needed" },
};
const payload: CataloguePayload = {
  generatedAt: "2026-11-23T11:00:00Z",
  canManage: true,
  rows: [row],
  oplocs: [],
  reviewGroups: [],
  canonicalisation: {
    itemsAwaitingConsolidation: 0,
    mergeGroupsReady: 0,
    reviewGroups: 0,
  },
  counts: { active: 1, archived: 0, needsReview: 0, routingRequired: 0 },
  serviceLayout: {
    company: {
      version: 3,
      services: { finger_food: { categories: ["Finger Food"] } },
    },
    sites: { "fictional-site": { version: 2, services: {} } },
    vocabulary: {
      catalogueCategories: ["Finger Food"],
      seedCategories: ["Finger Food"],
    },
  },
};

test("applies targeted Item and layout results without replacing a newer version", () => {
  const result = applyCatalogueReceipt(payload, {
    message: "Saved",
    package: "stale",
    rows: [
      {
        ...row,
        version: 2,
        name: "Earlier name",
        routing: { state: "in_house", version: 3, workstreams: [] },
      },
      {
        ...row,
        itemId: "fixture-new",
        version: 1,
        name: "Created Product",
        category: "New Category",
      },
    ],
    serviceLayoutStored: {
      company: { version: 2, services: {} },
      sites: {
        "fictional-site": {
          version: 3,
          services: { finger_food: { categories: ["New Category"] } },
        },
      },
    },
  });
  const item = result.rows.find((item) => item.itemId === row.itemId);
  assert.equal(item?.name, row.name);
  assert.equal(item?.routing.version, 3);
  assert.equal(result.serviceLayout?.company.version, 3);
  assert.equal(result.serviceLayout?.sites["fictional-site"]?.version, 3);
  assert.deepEqual(result.serviceLayout?.vocabulary.catalogueCategories, [
    "Finger Food",
    "New Category",
  ]);
  assert.equal(result.counts.active, 2);
  assert.equal(payload.rows[0], row);
});

test("governance full refresh uses the returned read model and updated permissions", () => {
  const refreshed = {
    ...payload,
    canManage: false,
    reviewGroups: [],
    rows: [],
  };
  const receipt = {
    message: "Review decision saved",
    package: "unchanged" as const,
    payload: refreshed,
  };
  assert.equal(applyCatalogueReceipt(payload, receipt), refreshed);
});

test("requires the precise bulk operation ID and versioned service receipt", () => {
  const command = { action: "bulk-create", operationId: "create-123456" };
  const report = {
    operationId: command.operationId,
    results: [],
    succeeded: 0,
    failed: 1,
    message: "One row declined",
  };
  const receipt = {
    message: report.message,
    package: "unchanged",
    rows: [],
    bulkCreate: report,
  };
  assert.equal(catalogueReceipt(receipt, command), receipt);
  assert.equal(
    catalogueReceipt(
      { ...receipt, bulkCreate: { ...report, operationId: "wrong-operation" } },
      command,
    ),
    null,
  );
  assert.equal(
    catalogueReceipt(
      { message: "Saved", package: "stale", rows: [] },
      { action: "set-service-categories" },
    ),
    null,
  );
  const layoutCommand = {
    action: "set-service-categories",
    expectedVersion: 2,
    oplocId: "fictional-site",
  };
  const old = {
    message: "Saved",
    package: "unchanged",
    serviceLayoutStored: payload.serviceLayout,
  };
  assert.equal(catalogueReceipt(old, layoutCommand), null);
  const stored = {
    ...payload.serviceLayout!,
    sites: { "fictional-site": { version: 3, services: {} } },
  };
  const latest = { ...old, serviceLayoutStored: stored };
  assert.equal(catalogueReceipt(latest, layoutCommand), latest);
});

test("uses the same-origin Studio route and distinguishes rejection from an unknown outcome", async () => {
  const command = {
    action: "set-item-status",
    itemId: row.itemId,
    expectedVersion: 2,
    status: "active",
  };
  const receipt = {
    message: "Product restored",
    package: "stale",
    rows: [row],
  };
  const result = await requestCatalogueCommand(command, async (input, init) => {
    assert.equal(input, "/api/catalogue");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init?.body)), command);
    return Response.json(receipt);
  });
  assert.deepEqual(result, receipt);
  await assert.rejects(
    requestCatalogueCommand(command, async () =>
      Response.json({ error: "Changed elsewhere" }, { status: 409 }),
    ),
    (failure: unknown) =>
      failure instanceof CatalogueCommandError &&
      failure.status === 409 &&
      failure.message === "Changed elsewhere",
  );
  await assert.rejects(
    requestCatalogueCommand(command, async () =>
      Response.json({ error: "Private auth diagnostic" }, { status: 403 }),
    ),
    (failure: unknown) =>
      failure instanceof CatalogueCommandError &&
      failure.status === 403 &&
      !failure.message.includes("diagnostic"),
  );
  await assert.rejects(
    requestCatalogueCommand(command, async () =>
      Response.json({ message: "Saved" }),
    ),
    (failure: unknown) =>
      failure instanceof CatalogueCommandError &&
      failure.status === undefined &&
      /unknown/.test(failure.message),
  );
  await assert.rejects(
    requestCatalogueCommand(command, async () => {
      throw new TypeError("Network failure");
    }),
    (failure: unknown) =>
      failure instanceof CatalogueCommandError && failure.status === undefined,
  );
});
