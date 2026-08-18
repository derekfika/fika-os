import assert from "node:assert/strict";
import test from "node:test";
import { SchemaCatalogue, schemaDefinition } from "../lib/schema-catalogue";
import { CanonicalEntityNames } from "../lib/schemas";

test("every supported canonical entity has exactly one deliberate schema definition", () => {
  assert.deepEqual(SchemaCatalogue.map(schema => schema.entityType).sort(), [...CanonicalEntityNames].sort());
  assert.equal(new Set(SchemaCatalogue.map(schema => schema.entityType)).size, CanonicalEntityNames.length);
  assert.equal(new Set(SchemaCatalogue.map(schema => schema.schemaId)).size, SchemaCatalogue.length);
});

test("catalogue definitions are versioned and contain unique governed fields", () => {
  for (const schema of SchemaCatalogue) {
    assert.equal(schema.version, "0.1.0");
    assert.equal(schema.lifecycle, "development");
    assert.equal(schemaDefinition(schema.entityType), schema);
    assert.equal(new Set(schema.fields.map(field => field.name)).size, schema.fields.length);
    assert.ok(schema.fields.some(field => field.name === "canonicalId" && !field.editable));
    assert.ok(schema.fields.some(field => field.name === "externalIdentities" && !field.editable));
  }
});
