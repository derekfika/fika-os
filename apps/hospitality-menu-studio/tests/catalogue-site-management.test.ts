import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredService,
  moveServiceCategory,
  renameCategoryImpact,
  serviceDraftProblem,
  serviceUpdateCommand,
  visibleServiceRule,
} from "../components/catalogue-service-editor-model";
import {
  siteOverrideDraft,
  siteOverridePatch,
  siteValues,
} from "../components/catalogue-site-editor-model";
import { confirmsSiteCommand } from "../components/catalogue-site-operation";
import type {
  CatalogueOffering,
  CataloguePayload,
  CatalogueRow,
  CatalogueServiceLayout,
} from "../components/catalogue-wire";

const companyPrice = {
  amount: 12,
  vatRate: 0.2,
  priceId: "price:company",
  version: 1,
  effectiveFrom: "2026-11-23",
};
const sitePrice = {
  amount: 15,
  vatRate: 0.05,
  priceId: "price:site-b",
  version: 2,
  effectiveFrom: "2026-11-23",
};

const siteA = "oploc:site-a";
const siteB = "oploc:site-b";
const item: CatalogueRow = {
  itemId: "item:finger-food",
  version: 7,
  name: "Finger food bites",
  category: "Finger Food",
  description: "",
  status: "active",
  routing: { state: "in_house", workstreams: [], version: 1 },
  defaultPrice: companyPrice,
  defaultMode: "standard",
  defaultMinimumQuantity: 6,
  defaultMinimumGuests: 4,
  defaultNoticeRequiredDays: 1,
  offerings: [],
  availableAt: [siteA],
  unavailableAt: [siteB],
  overrideCount: 0,
  needsReview: [],
  sourceIds: [],
  providerMappings: [],
  dietaryInformation: [],
  allergenInformation: [],
  priceMigration: { status: "not_needed" },
};

const siteBOverride: CatalogueOffering = {
  offeringId: "offering:site-b",
  version: 8,
  oplocId: siteB,
  mode: "standard",
  status: "active",
  price: { source: "overrides", effective: sitePrice, override: sitePrice },
  minimum: { source: "overrides", effective: 12, override: 12 },
  minimumGuestsOverride: 5,
  noticeRequiredDaysOverride: 2,
  description: "Old wording",
  available: false,
  noEffect: false,
};

test("site display uses stable IDs and excludes area and archived records from site-wide editing", () => {
  const area = {
    ...siteBOverride,
    offeringId: "offering:area",
    oplocId: siteA,
    operationalAreaId: "area:example",
  };
  const archived: CatalogueOffering = {
    ...siteBOverride,
    offeringId: "offering:archived",
    status: "archived",
  };
  const row = { ...item, offerings: [archived, area, siteBOverride] };
  assert.deepEqual(siteValues(row, siteA), {
    available: true,
    mode: "standard",
    offering: undefined,
    ambiguous: false,
  });
  assert.equal(siteValues(row, siteB).available, false);
  assert.equal(
    siteValues(row, siteB).offering?.offeringId,
    siteBOverride.offeringId,
  );
  assert.equal(
    siteValues({ ...item, defaultMode: "quote_only" }, siteA).mode,
    "quote_only",
  );
  assert.equal(
    siteValues(
      {
        ...row,
        offerings: [
          ...row.offerings,
          { ...siteBOverride, offeringId: "offering:duplicate" },
        ],
      },
      siteB,
    ).ambiguous,
    true,
  );
});

test("site price, VAT and quantity patches preserve other fields and explicit inheritance", () => {
  const draft = siteOverrideDraft(
    item,
    siteValues({ ...item, offerings: [siteBOverride] }, siteB),
  );
  assert.deepEqual(draft, {
    mode: "standard",
    price: "15.00",
    vat: "5",
    minimum: "12",
    guests: "5",
    notice: "2",
    displayName: "",
    description: "Old wording",
  });
  assert.deepEqual(
    siteOverridePatch(
      draft,
      { ...draft, vat: "20", minimum: "8", notice: "0" },
      companyPrice,
    ),
    {
      price: { amount: 15, vatRate: 0.2 },
      minimumQuantity: 8,
      noticeRequiredDays: 0,
    },
  );
  assert.deepEqual(
    siteOverridePatch(
      draft,
      {
        ...draft,
        price: "",
        minimum: "",
        guests: "",
        notice: "",
        description: " ",
      },
      companyPrice,
    ),
    {
      price: null,
      minimumQuantity: null,
      minimumGuests: null,
      noticeRequiredDays: null,
      description: null,
    },
  );
  assert.deepEqual(
    siteOverridePatch(
      draft,
      { ...draft, price: "15", vat: "5.00", displayName: " New wording " },
      companyPrice,
    ),
    {
      displayName: "New wording",
    },
  );
});

test("quote-only mode clears a current site price in the same command", () => {
  const draft = siteOverrideDraft(
    item,
    siteValues({ ...item, offerings: [siteBOverride] }, siteB),
  );
  assert.deepEqual(
    siteOverridePatch(draft, { ...draft, mode: "quote_only" }, companyPrice),
    {
      offeringMode: "quote_only",
      price: null,
    },
  );
  const inherited = siteOverrideDraft(item, siteValues(item, siteA));
  assert.deepEqual(
    siteOverridePatch(
      inherited,
      { ...inherited, mode: "quote_only" },
      companyPrice,
    ),
    {
      offeringMode: "quote_only",
    },
  );
  assert.throws(
    () =>
      siteOverridePatch(inherited, { ...inherited, price: "12" }, companyPrice),
    /company price/,
  );
  assert.throws(
    () =>
      siteOverridePatch(
        inherited,
        { ...inherited, price: "13.001" },
        companyPrice,
      ),
    /decimal places/,
  );
  assert.throws(
    () =>
      siteOverridePatch(
        inherited,
        { ...inherited, price: "13", vat: "101" },
        companyPrice,
      ),
    /0 and 100/,
  );
  assert.throws(
    () =>
      siteOverridePatch(
        inherited,
        { ...inherited, minimum: "0" },
        companyPrice,
      ),
    /Minimum quantity/,
  );
});

const layout: CatalogueServiceLayout = {
  company: {
    version: 4,
    services: { finger_food: { categories: ["Finger Food", "Drinks"] } },
  },
  sites: {
    [siteB]: {
      version: 9,
      services: { finger_food: { categories: ["Drinks", "Finger Food"] } },
    },
  },
  vocabulary: {
    catalogueCategories: ["Finger Food"],
    seedCategories: ["Finger Food", "Drinks"],
  },
};

test("company and site changes use the selected scope revision and preserve category order when hiding", () => {
  const company = configuredService(layout, "", "finger_food");
  const inherited = configuredService(layout, siteA, "finger_food");
  const site = configuredService(layout, siteB, "finger_food");
  assert.equal(company.version, 4);
  assert.equal(inherited.version, 0);
  assert.deepEqual(inherited.rule, company.rule);
  assert.deepEqual(site.rule.categories, ["Drinks", "Finger Food"]);
  assert.deepEqual(
    serviceUpdateCommand(
      "finger_food",
      siteB,
      site.version,
      "  Seasonal closure  ",
      visibleServiceRule(site.rule, false),
    ),
    {
      action: "set-service-categories",
      serviceId: "finger_food",
      oplocId: siteB,
      expectedVersion: 9,
      categories: ["Drinks", "Finger Food"],
      hidden: true,
      reason: "Seasonal closure",
    },
  );
  assert.deepEqual(
    serviceUpdateCommand(
      "finger_food",
      siteB,
      site.version,
      "Follow the company plan",
    ),
    {
      action: "clear-service-override",
      serviceId: "finger_food",
      oplocId: siteB,
      expectedVersion: 9,
      reason: "Follow the company plan",
    },
  );
  assert.equal(
    serviceDraftProblem(site, company.rule, siteB),
    "Use the company settings to inherit this layout.",
  );
  assert.match(serviceDraftProblem(company, { categories: [] }, "")!, /hide/);
  assert.deepEqual(moveServiceCategory(site.rule.categories, 0, 1), [
    "Finger Food",
    "Drinks",
  ]);
  assert.deepEqual(site.rule.categories, ["Drinks", "Finger Food"]);
});

test("category rename uses archived Items and exactly the affected stored layouts", () => {
  const archived: CatalogueRow = {
    ...item,
    itemId: "item:archived",
    status: "archived",
    version: 2,
  };
  const other: CatalogueRow = {
    ...item,
    itemId: "item:different-case",
    category: "finger food",
  };
  const payload: CataloguePayload = {
    generatedAt: "",
    canManage: true,
    rows: [item, archived, other],
    oplocs: [],
    reviewGroups: [],
    counts: { active: 2, archived: 1, needsReview: 0, routingRequired: 0 },
    canonicalisation: {
      itemsAwaitingConsolidation: 0,
      mergeGroupsReady: 0,
      reviewGroups: 0,
    },
    serviceLayout: layout,
  };
  const impact = renameCategoryImpact(payload, "Finger Food");
  assert.deepEqual(impact.expectedItemVersions, {
    [item.itemId]: 7,
    [archived.itemId]: 2,
  });
  assert.deepEqual(impact.expectedLayoutVersions, {
    company: 4,
    ["site:" + siteB]: 9,
  });
  const seeding = { ...layout, company: { ...layout.company, version: 0 } };
  assert.deepEqual(
    renameCategoryImpact({ ...payload, serviceLayout: seeding }, "Finger Food")
      .expectedLayoutVersions,
    {
      ["site:" + siteB]: 9,
    },
  );
});

test("site and service saves require the matching target state and newer Hub revision", () => {
  const envelope = { message: "Settings saved", package: "published" as const };
  const availability = {
    action: "set-site-availability",
    itemId: item.itemId,
    expectedVersion: item.version,
    oplocId: siteB,
    available: true,
  };
  assert.equal(confirmsSiteCommand(envelope, availability), false);
  assert.equal(
    confirmsSiteCommand({ ...envelope, rows: [item] }, availability),
    false,
  );
  assert.equal(
    confirmsSiteCommand(
      { ...envelope, rows: [{ ...item, version: 8 }] },
      availability,
    ),
    false,
  );
  assert.equal(
    confirmsSiteCommand(
      {
        ...envelope,
        rows: [{ ...item, version: 8, availableAt: [siteA, siteB] }],
      },
      availability,
    ),
    true,
  );

  const service = serviceUpdateCommand(
    "finger_food",
    siteB,
    9,
    "Apply seasonal hours",
    { categories: ["Drinks"], hidden: true },
  );
  assert.equal(
    confirmsSiteCommand({ ...envelope, serviceLayoutStored: layout }, service),
    false,
  );
  const updatedLayout = {
    ...layout,
    sites: {
      [siteB]: {
        version: 10,
        services: { finger_food: { categories: ["Drinks"], hidden: true } },
      },
    },
  };
  assert.equal(
    confirmsSiteCommand(
      { ...envelope, serviceLayoutStored: updatedLayout },
      service,
    ),
    true,
  );
  const clear = serviceUpdateCommand(
    "finger_food",
    siteB,
    9,
    "Restore company layout",
  );
  assert.equal(
    confirmsSiteCommand(
      { ...envelope, serviceLayoutStored: updatedLayout },
      clear,
    ),
    false,
  );
  assert.equal(
    confirmsSiteCommand(
      {
        ...envelope,
        serviceLayoutStored: {
          ...updatedLayout,
          sites: { [siteB]: { version: 10, services: {} } },
        },
      },
      clear,
    ),
    true,
  );
});
