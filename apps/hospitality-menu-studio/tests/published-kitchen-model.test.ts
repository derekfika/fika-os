import assert from "node:assert/strict";
import test from "node:test";
import { boxCount, publishedDishPage, publishedKitchenPreview, KitchenRequestGuard } from "../components/published-kitchen-model";

const selected = { id: "dish-1", name: "Frozen dish", version: 2 };
const result = {
  kind: "published-content-preview",
  publication: { id: "pub-1", menuId: "menu-1", revision: 3, effectiveDate: "2099-01-01" },
  safety: { subject: { dishId: "dish-1", revision: 2, sourceHash: "a".repeat(64) }, releaseId: "release-1", matrixHash: "b".repeat(64) },
  dish: { ...selected, kitchenDescription: "Frozen instructions", assortment: { expectedTotal: 24, unit: "pieces", components: [{ id: "a", name: "A", quantity: 12 }, { id: "b", name: "B", quantity: 12 }] } },
  quantities: { boxes: 4, unit: "pieces", perBox: 24, total: 96, components: [{ id: "a", name: "A", perBox: 12, total: 48 }, { id: "b", name: "B", perBox: 12, total: 48 }] },
};
test("index requires real frozen dish identities and a bounded cursor", () => {
  assert.deepEqual(publishedDishPage({ items: [selected], nextCursor: null }), { items: [selected], nextCursor: null });
  assert.equal(publishedDishPage({ items: [selected, selected], nextCursor: null }), null);
  assert.equal(publishedDishPage({ items: [{ ...selected, version: 0 }], nextCursor: null }), null);
  assert.equal(publishedDishPage({ items: [selected] }), null);
  assert.equal(publishedDishPage({ items: [selected], nextCursor: "other" }), null);
  assert.deepEqual(publishedDishPage({ items: [selected], nextCursor: selected.id }), { items: [selected], nextCursor: selected.id });
});
test("published preview binds publication, dish version and evidence before displaying quantities", () => {
  assert.equal(publishedKitchenPreview(result, "menu-1", "pub-1", selected, 4)?.quantities?.total, 96);
  assert.equal(publishedKitchenPreview(result, "menu-1", "other", selected, 4), null);
  assert.equal(publishedKitchenPreview(result, "menu-1", "pub-1", { ...selected, version: 3 }, 4), null);
  assert.equal(publishedKitchenPreview({ ...result, safety: { ...result.safety, subject: { ...result.safety.subject, revision: 1 } } }, "menu-1", "pub-1", selected, 4), null);
  assert.equal(publishedKitchenPreview({ ...result, quantities: { ...result.quantities, total: 24 } }, "menu-1", "pub-1", selected, 4), null);
  assert.equal(publishedKitchenPreview(result, "menu-1", "pub-1", selected, 1), null);
  const plain = { ...result, dish: { ...result.dish, assortment: null }, quantities: undefined };
  assert.ok(publishedKitchenPreview(plain, "menu-1", "pub-1", selected, undefined));
  assert.equal(publishedKitchenPreview(plain, "menu-1", "pub-1", selected, 1), null);
});
test("box input accepts only positive safe whole values", () => {
  assert.equal(boxCount("4"), 4);
  for (const value of ["", "0", "-1", "1.5", "1e2", "9007199254740992"]) assert.equal(boxCount(value), null);
});

test("changed selection, count or unmount invalidates late preview results", () => {
  const guard = new KitchenRequestGuard();
  const prior = guard.next();
  guard.invalidate();
  assert.equal(guard.isCurrent(prior), false);
  const olderRequest = guard.next();
  const latestRequest = guard.next();
  assert.equal(guard.isCurrent(olderRequest), false);
  assert.equal(guard.isCurrent(latestRequest), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(latestRequest), false);
});
