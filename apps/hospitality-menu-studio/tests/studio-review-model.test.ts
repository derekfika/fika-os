import assert from "node:assert/strict";
import test from "node:test";
import type { Dish, Menu, Review } from "../lib/contract";
import {
  assortmentProgress,
  presentReviewIssues,
} from "../components/studio-review-model";

const menu: Menu = {
  id: "menu",
  version: 1,
  name: "Spring",
  kind: "seasonal",
  startDate: "2027-02-01",
  endDate: "2027-03-31",
  anchorMonday: "2027-02-01",
  updatedAt: "",
  sections: [
    {
      id: "canapes",
      name: "Canapés",
      mode: "static",
      catalogueItemId: "",
      staticDishIds: ["bite"],
      weeks: [[], [], [], [], [], []],
    },
  ],
};
const dish: Dish = {
  id: "bite",
  version: 1,
  name: "Bite",
  category: "other",
  temperature: null,
  customerDescription: "",
  kitchenDescription: "",
  assortment: null,
  updatedAt: "",
};
const review: Review = {
  canPublish: false,
  reviewToken: null,
  safety: { status: "unavailable" },
  impact: { status: "unavailable" },
  changes: [],
  issues: [
    "Canapés needs a Hub catalogue mapping.",
    "Bite needs a name and both descriptions.",
    "A future check returned an unfamiliar result.",
    "Signed dish verification, catalogue eligibility and booking impact are unavailable.",
  ],
};

test("review presentation separates only the known unavailable-authorities message", () => {
  assert.deepEqual(presentReviewIssues(review, menu, [dish]), {
    editable: [
      {
        text: "Canapés needs a Hub catalogue mapping.",
        target: { kind: "section", id: "canapes" },
      },
      {
        text: "Bite needs a name and both descriptions.",
        target: { kind: "dish", id: "bite" },
      },
    ],
    other: ["A future check returned an unfamiliar result."],
    authoritiesUnavailable: true,
  });
});

test("duplicate names never select an arbitrary editor", () => {
  const duplicate = { ...dish, id: "another" };
  assert.deepEqual(
    presentReviewIssues(review, menu, [dish, duplicate]).editable[1]?.target,
    { kind: "menu" },
  );
});

test("assortment progress handles missing, remaining, excess and exact totals", () => {
  assert.equal(
    assortmentProgress(12, 24, "pieces"),
    "12 of 24 pieces entered — 12 remaining",
  );
  assert.equal(
    assortmentProgress(25, 24, "pieces"),
    "25 of 24 pieces entered — 1 over",
  );
  assert.equal(assortmentProgress(24, 24, "pieces"), "24 of 24 pieces entered");
  assert.equal(
    assortmentProgress(0, 0, ""),
    "Enter the expected total per box.",
  );
});
