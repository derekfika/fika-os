#!/usr/bin/env node

// Restored from the approved Pack 3 source artefact and adapted only so that
// its root is the integrated repository Pack directory.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function typeOk(expected, value) {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some((type) => type === 'array'
    ? Array.isArray(value)
    : type === 'object'
      ? isObject(value)
      : type === 'integer'
        ? Number.isInteger(value)
        : type === 'null'
          ? value === null
          : typeof value === type);
}
function resolveRef(schema, ref) { return schema.$defs[ref.slice('#/$defs/'.length)]; }
function validateNode(rootSchema, schema, value, pointer, errors) {
  if (schema.$ref) return validateNode(rootSchema, resolveRef(rootSchema, schema.$ref), value, pointer, errors);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${pointer}: expected const ${schema.const}`);
  if (schema.type && !typeOk(schema.type, value)) { errors.push(`${pointer}: type mismatch`); return; }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${pointer}: value not in enum`);
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) errors.push(`${pointer}: below minLength`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${pointer}: below minimum`);
  if (schema.pattern && typeof value === 'string' && !(new RegExp(schema.pattern).test(value))) errors.push(`${pointer}: pattern mismatch`);
  if (schema.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) errors.push(`${pointer}: invalid date-time`);
  if (schema.type === 'object' && isObject(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${pointer}/${required}: required property missing`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${pointer}/${key}: additional property not allowed`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) validateNode(rootSchema, child, value[key], `${pointer}/${key}`, errors);
    }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pointer}: below minItems`);
    if (schema.items) value.forEach((item, index) => validateNode(rootSchema, schema.items, item, `${pointer}/${index}`, errors));
  }
}
function validate(schema, data) {
  const errors = [];
  validateNode(schema, schema, data, '', errors);
  return errors;
}

let failures = 0;
const results = [];
for (const schemaFile of fs.readdirSync(root).filter((file) => file.endsWith('.schema.json')).sort()) {
  const base = schemaFile.replace('.schema.json', '');
  const schema = readJson(path.join(root, schemaFile));
  for (const [kind, expectedPass] of [['valid', true], ['invalid', false]]) {
    const fixture = `${kind}-${base}.json`;
    const errors = validate(schema, readJson(path.join(root, 'fixtures', kind, fixture)));
    const actualPass = errors.length === 0;
    if (actualPass !== expectedPass) failures += 1;
    results.push({
      schema: schemaFile,
      fixture,
      expected: expectedPass ? 'pass' : 'fail',
      actual: actualPass ? 'pass' : 'fail',
      errors,
    });
  }
}

console.log(JSON.stringify({
  validator: 'restored Pack 3 local structural JSON Schema subset validator',
  failures,
  results,
}, null, 2));
process.exit(failures ? 1 : 0);
