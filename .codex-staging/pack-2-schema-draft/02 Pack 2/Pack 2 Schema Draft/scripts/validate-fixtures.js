#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function typeOk(expected, value) {
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some(t => t === 'array' ? Array.isArray(value) : t === 'object' ? isObject(value) : t === 'integer' ? Number.isInteger(value) : t === 'null' ? value === null : typeof value === t);
}
function resolveRef(schema, ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`Unsupported ref ${ref}`);
  return schema.$defs[ref.slice('#/$defs/'.length)];
}
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
    const props = schema.properties || {};
    for (const req of schema.required || []) if (!(req in value)) errors.push(`${pointer}/${req}: required property missing`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in props)) errors.push(`${pointer}/${key}: additional property not allowed`);
    for (const [key, child] of Object.entries(props)) if (key in value) validateNode(rootSchema, child, value[key], `${pointer}/${key}`, errors);
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pointer}: below minItems`);
    if (schema.items) value.forEach((item, i) => validateNode(rootSchema, schema.items, item, `${pointer}/${i}`, errors));
  }
}
function validate(schema, data) { const errors = []; validateNode(schema, schema, data, '', errors); return errors; }

let failures = 0;
const results = [];
const schemas = fs.readdirSync(path.join(root, 'schemas')).filter(f => f.endsWith('.schema.json')).sort();
for (const schemaFile of schemas) {
  const base = schemaFile.replace('.schema.json', '');
  const schema = readJson(path.join(root, 'schemas', schemaFile));
  for (const [kind, shouldPass] of [['valid', true], ['invalid', false]]) {
    const fixture = `${kind}-${base}.json`;
    const data = readJson(path.join(root, 'fixtures', kind, fixture));
    const errors = validate(schema, data);
    const actualPass = errors.length === 0;
    if (actualPass !== shouldPass) failures++;
    results.push({schema: schemaFile, fixture, expected: shouldPass ? 'pass' : 'fail', actual: actualPass ? 'pass' : 'fail', errors});
  }
}
const output = {validator: 'local structural JSON Schema subset validator for Pack 2 fixtures', failures, results};
console.log(JSON.stringify(output, null, 2));
process.exit(failures ? 1 : 0);
