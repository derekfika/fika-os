import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptionPrice,
  defaultAssessment,
  linkedStudioSections,
  mergeSelection,
} from "../components/catalogue-governance-model";
import type {
  CataloguePayload,
  CatalogueRow,
} from "../components/catalogue-wire";
import type { Menu, Section } from "../lib/contract";

const row = (
  itemId: string,
  version: number,
  status: CatalogueRow["status"] = "active",
) => ({ itemId, version, status }) as CatalogueRow;
const fixture: Pick<CataloguePayload, "rows" | "reviewGroups"> = {
  rows: [
    row("item:product-a", 5),
    row("item:product-b", 2),
    row("item:outside", 8),
  ],
  reviewGroups: [
    {
      id: "group-a",
      memberIds: ["item:product-a", "item:product-b"],
      reasons: [],
    },
  ],
};

test("duplicate review sends only the reviewed canonical IDs and their current versions", () => {
  assert.deepEqual(mergeSelection(fixture, "group-a", "item:product-b"), {
    action: "merge-items",
    groupId: "group-a",
    survivorItemId: "item:product-b",
    sourceItemIds: ["item:product-a"],
    expectedVersions: { "item:product-a": 5, "item:product-b": 2 },
  });
  assert.equal(mergeSelection(fixture, "group-a", "item:outside"), null);
  assert.equal(
    mergeSelection(
      { ...fixture, rows: [fixture.rows[0]] },
      "group-a",
      "item:product-a",
    ),
    null,
  );
  assert.equal(
    mergeSelection(
      {
        ...fixture,
        rows: [fixture.rows[0], row("item:product-b", 2, "archived")],
      },
      "group-a",
      "item:product-a",
    ),
    null,
  );
});

test("default adoption uses reviewed Hub findings, explicit price and fractional VAT", () => {
  const uniform = {
    status: "uniform",
    amount: 2.75,
    vatRate: 0.2,
    minimumQuantity: 5,
  };
  assert.deepEqual(
    defaultAssessment({ ...fixture.rows[0], priceMigration: uniform }),
    uniform,
  );
  assert.deepEqual(
    defaultAssessment({
      ...fixture.rows[0],
      priceMigration: { status: "uniform" },
    }),
    { status: "not_needed" },
  );
  assert.deepEqual(adoptionPrice("2.75", "20"), { amount: 2.75, vatRate: 0.2 });
  assert.deepEqual(adoptionPrice("0", "0"), { amount: 0, vatRate: 0 });
  assert.equal(adoptionPrice("", "20"), null);
  assert.equal(adoptionPrice("4.005", "20"), null);
  assert.equal(adoptionPrice("4.00", "120"), null);
});

test("reverse links use canonical IDs from visible menus even when names match", () => {
  const section = (id: string, catalogueItemId: string) =>
    ({
      id,
      name: "Finger Food",
      catalogueItemId,
    }) as Section;
  const menus = [
    {
      id: "menu-1",
      name: "Spring",
      sections: [section("section-1", "item:product-a")],
    },
    {
      id: "menu-2",
      name: "Spring",
      sections: [section("section-2", "item:product-b")],
    },
  ] as Menu[];
  assert.deepEqual(
    linkedStudioSections(
      menus,
      (entry) => entry.catalogueItemId === "item:product-b",
    ),
    [
      {
        menuId: "menu-2",
        menuName: "Spring",
        sectionId: "section-2",
        sectionName: "Finger Food",
      },
    ],
  );
});
