import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalJson } from '../src/canonical-json.js';
import { readJson, safeOutputPath } from '../src/io.js';
import { reconcile } from '../src/reconcile.js';
import { semanticSnapshotValidation } from '../src/snapshot.js';
import { createValidator } from '../src/validation.js';
import { run } from '../src/cli.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'config', 'increment-1.test-config.v1.json');
const validPath = join(root, 'fixtures', 'synthetic', 'valid', 'monday-to-friday.json');
const duplicatePath = join(root, 'fixtures', 'synthetic', 'valid', 'duplicate-source-record.json');
const missingProvenancePath = join(root, 'fixtures', 'synthetic', 'invalid', 'missing-provenance.json');
const unknownFieldPath = join(root, 'fixtures', 'synthetic', 'invalid', 'unknown-field.json');
const schemaPath = join(root, 'contracts', 'cpu-intake-snapshot.schema.json');
const configSchemaPath = join(root, 'contracts', 'test-config.schema.json');

async function validators() {
  return {
    validateSnapshot: createValidator(await readJson(schemaPath)),
    validateConfig: createValidator(await readJson(configSchemaPath)),
  };
}

async function tempOutput() {
  return mkdtemp(join(tmpdir(), 'fika-cpu-shadow-'));
}

test('valid snapshot and approved non-canonical configuration are accepted', async () => {
  const snapshot = await readJson(validPath);
  const config = await readJson(configPath);
  const { validateSnapshot, validateConfig } = await validators();
  assert.deepEqual(validateSnapshot(snapshot), { valid: true, errors: [] });
  assert.deepEqual(validateConfig(config), { valid: true, errors: [] });
  assert.deepEqual(semanticSnapshotValidation(snapshot, config), { valid: true, errors: [] });
  assert.equal(snapshot.scope.producingOperationalLocationId, 'oploc:cpux');
  assert.equal(config.hostOperationalLocationId, 'oploc:fika-xchange');
  assert.equal(config.hostingAssertion.canonicalRelationship, false);
});

test('invalid, incomplete, unknown-field, and wrong-identity input fail closed', async () => {
  const { validateSnapshot } = await validators();
  assert.equal(validateSnapshot(await readJson(missingProvenancePath)).valid, false);
  const unknown = validateSnapshot(await readJson(unknownFieldPath));
  assert.equal(unknown.valid, false);
  assert(unknown.errors.some((error) => error.keyword === 'additionalProperties'));

  const snapshot = await readJson(validPath);
  const config = await readJson(configPath);
  snapshot.scope.producingOperationalLocationId = 'oploc:fika-xchange';
  assert.equal(validateSnapshot(snapshot).valid, false);
  assert.equal(semanticSnapshotValidation(snapshot, config).valid, false);
});

test('provenance, uncertainty, partial input, and identity classes remain separate', async () => {
  const snapshot = await readJson(validPath);
  const config = await readJson(configPath);
  const evidence = reconcile(snapshot, config, snapshot.scope.asOf);
  const friday = evidence.observations.find((item) => item.sourceObservationId === 'observation:friday');
  assert.equal(friday.mappingOutcome, 'partial-source-observation');
  assert(friday.uncertainties.includes('disappearance-is-not-confirmed-cancellation'));
  assert(friday.exclusions.includes('cancellation-meaning'));
  assert.notEqual(friday.sourceObservationId, friday.sourceRecordId);
  assert.notEqual(friday.sourceRecordId, friday.shadowOrderId);
  assert.notEqual(evidence.mappingRunId, evidence.reconciliationRunId);
  assert.notEqual(evidence.reconciliationRunId, evidence.evidenceExportId);
  assert.equal(friday.sourceProvenance.observedAt, '2026-07-24T17:54:00+01:00');
  assert.equal(evidence.snapshot.provenance.sourceReference, 'fixture:monday-to-friday');
});

test('duplicate source records create stable discrepancies without a universal match score', async () => {
  const snapshot = await readJson(duplicatePath);
  const config = await readJson(configPath);
  const evidence = reconcile(snapshot, config, snapshot.scope.asOf);
  assert.equal(evidence.outcome, 'completed-with-discrepancies');
  assert.equal(evidence.discrepancies.length, 1);
  assert.equal(evidence.discrepancies[0].type, 'duplicate-source-record');
  assert.equal('matchScore' in evidence, false);
});

test('reconciliation is deterministic and does not mutate source fixtures', async () => {
  const snapshot = await readJson(validPath);
  const config = await readJson(configPath);
  const before = structuredClone(snapshot);
  const first = canonicalJson(reconcile(snapshot, config, snapshot.scope.asOf));
  const second = canonicalJson(reconcile(snapshot, config, snapshot.scope.asOf));
  assert.equal(first, second);
  assert.deepEqual(snapshot, before);
});

test('CLI writes only beneath an explicit absolute output directory', async () => {
  const output = await tempOutput();
  assert.throws(() => safeOutputPath(output, '..', 'escape.json'), /escapes/);
  assert.throws(() => safeOutputPath('relative-output', 'file.json'), /escapes|absolute/);
  const code = await run(['validate', '--input', validPath, '--config', configPath, '--output-dir', output, '--as-of', '2026-07-25T00:00:00+01:00']);
  assert.equal(code, 0);
  const entries = await readdir(join(output, 'validation'));
  assert.equal(entries.length, 1);
  assert.equal((await stat(join(output, 'validation', entries[0]))).isFile(), true);
});

test('a later failed run quarantines input and preserves prior reconciliation evidence', async () => {
  const output = await tempOutput();
  const success = await run(['reconcile', '--input', validPath, '--config', configPath, '--output-dir', output, '--as-of', '2026-07-25T00:00:00+01:00']);
  assert.equal(success, 0);
  const priorFiles = await readdir(join(output, 'reconciliation'));
  assert.equal(priorFiles.length, 1);
  const priorPath = join(output, 'reconciliation', priorFiles[0]);
  const priorBytes = await readFile(priorPath);

  const failure = await run(['reconcile', '--input', unknownFieldPath, '--config', configPath, '--output-dir', output, '--as-of', '2026-07-21T00:00:00+01:00']);
  assert.equal(failure, 2);
  assert.deepEqual(await readFile(priorPath), priorBytes);
  assert.equal((await readdir(join(output, 'quarantine'))).length, 1);
});

test('the package requires no network or provider integration', async () => {
  const packageJson = await readJson(join(root, 'package.json'));
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ['ajv', 'ajv-formats']);
  for (const file of ['src/cli.js', 'src/io.js', 'src/reconcile.js', 'src/snapshot.js']) {
    const source = await readFile(join(root, file), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\/|googleapis|firebase|oauth|service.?account/i);
  }
});
