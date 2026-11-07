import test from "node:test";
import assert from "node:assert/strict";
import { POST as preview } from "../app/api/imports/preview/route";
import { POST as commit } from "../app/api/imports/commit/route";
import { MAX_PASTED_RECIPE_CANDIDATES } from "../lib/contracts";
import { previewPastedRecipes } from "../lib/import-preview";

const text = [
  "Name: Fika Cooler",
  "Type: Mocktail",
  "Ingredients:",
  "- 12.5 mL lime juice",
  "- mint leaves",
  "- 0 g salt",
  "Method: Shake with ice.",
  "Strain into the glass.",
  "Glassware: Highball",
  "Equipment: Shaker",
  "Garnish: Lime wheel",
  "Allergens: None",
  "Price: £2",
  "",
  "Drink : FIKA COOLER",
  "Type: Cold drink",
  "Ingredient: 2 dashes bitters",
  "Method: Stir.",
].join("\n");

test("pasted recipes split on named blocks, isolate fields and warn about incomplete quantities and duplicate names", () => {
  const result = previewPastedRecipes(text);
  const [first, second] = result.candidates;
  assert.equal(result.candidates.length, 2);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.sourceHash, previewPastedRecipes(` \r\n${text.replaceAll("\n", "\r\n")}\r\n `).sourceHash);
  assert.deepEqual([first.index, second.index], [0, 1]);
  assert.notEqual(first.candidateHash, second.candidateHash);
  assert.deepEqual(first.recipe.ingredients, [
    { amount: 12.5, unit: "ml", name: "lime juice" }, { name: "mint leaves" }, { name: "0 g salt" },
  ]);
  assert.equal(first.recipe.method, "Shake with ice.\nStrain into the glass.");
  assert.equal(first.recipe.glassware, "Highball");
  assert.equal(first.recipe.garnish, "Lime wheel");
  assert.deepEqual(first.recipe.equipment, ["Shaker"]);
  assert.ok(first.warnings.some(warning => warning.includes("omitted")));
  assert.equal(first.confidence, "medium");
  assert.equal(second.confidence, "high");
  assert.deepEqual(second.recipe.ingredients, [{ amount: 2, unit: "dash", name: "bitters" }]);
  assert.ok(result.candidates.every(candidate => candidate.warnings.some(warning => warning.includes("duplicate name within"))));
  assert.ok(!JSON.stringify(first.recipe).includes("£2"));
});

test("separators isolate unlabelled titles, and ingredient-only text remains unnamed", () => {
  const { candidates } = previewPastedRecipes("Plain titled drink\n30 ml lime juice\n---\nIngredients:\nwater");
  assert.equal(candidates[0].recipe.name, "Plain titled drink");
  assert.equal(candidates[0].confidence, "medium");
  assert.equal(candidates[1].recipe.name, "");
  assert.equal(candidates[1].confidence, "low");
  assert.deepEqual(candidates[1].recipe.ingredients, [{ name: "water" }]);
  assert.throws(() => previewPastedRecipes(" \r\n "), /Paste fictional recipe text/);
  assert.throws(() => previewPastedRecipes("x".repeat(20_001)), /20.?000 characters/);
  assert.throws(() => previewPastedRecipes(Array.from({ length: MAX_PASTED_RECIPE_CANDIDATES + 1 }, (_, index) => `Name: Drink ${index}`).join("\n")), /at most 20 drinks/);
});

function request(body: unknown, action = "commit", host = "localhost") {
  return new Request(`http://${host}:13617/api/imports/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "fixture-import:test" },
    body: JSON.stringify(body),
  });
}

test("import routes retain local fixture gates and reject unreviewed, altered and unsafe commit payloads before persistence", async t => {
  const fixtureEnv = {
    NODE_ENV: "test", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "demo-fika-os",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8294", FIKA_BEVERAGE_LOCAL_AUTH: "fixture",
    FIKA_BEVERAGE_LOCAL_ACTOR_ID: "fixture:import-test", FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS: "Contribute",
  };
  for (const [name, value] of Object.entries(fixtureEnv)) {
    const previous = process.env[name];
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    process.env[name] = value;
  }
  assert.ok((await preview(request({ text }, "preview"))).status >= 400);
  assert.ok((await commit(request({ text }))).status >= 400);
  process.env.FIKA_RUNTIME_MODE = "local";
  assert.equal((await preview(request({ text }, "preview", "example.test"))).status, 403);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  assert.equal((await commit(request({ text }))).status, 403);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "Contribute";
  assert.equal((await preview(request({ text: 12 }, "preview"))).status, 400);

  const result = previewPastedRecipes(text);
  const candidate = result.candidates[0];
  const body = {
    text, sourceHash: result.sourceHash, candidateIndex: candidate.index, candidateHash: candidate.candidateHash,
    classification: "classic_source", reviewed: true, reviewedCandidate: candidate.recipe,
  };
  for (const patch of [
    { reviewed: undefined }, { reviewed: false }, { classification: undefined }, { reviewedCandidate: undefined },
    { sourceHash: undefined }, { candidateIndex: undefined }, { candidateHash: undefined },
    { candidateIndex: "0" }, { reviewedCandidate: { ...candidate.recipe, allergens: ["clear"] } },
    { reviewedCandidate: { ...candidate.recipe, ingredients: [{ name: "Mint", costPerUnit: 0 }] } },
    { reviewedCandidate: { ...candidate.recipe, ingredients: [{ name: "Mint", amount: 1 }] } },
  ]) {
    const response = await commit(request({ ...body, ...patch }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "BEVERAGE_REQUEST_INVALID");
  }
  for (const patch of [
    { text: `${text}\nDescription: Changed after preview` }, { sourceHash: "0".repeat(64) },
    { candidateIndex: 1 }, { candidateIndex: 3 }, { candidateHash: "f".repeat(64) },
  ]) {
    const response = await commit(request({ ...body, ...patch }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "BEVERAGE_IMPORT_PREVIEW_CHANGED");
  }
});
