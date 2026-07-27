#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExplicitOutputDirectory, preserveEvidence, readJson, safeOutputPath } from './io.js';
import { derivedId } from './identity.js';
import { reconcile } from './reconcile.js';
import { quarantineEvidence, semanticSnapshotValidation } from './snapshot.js';
import { createValidator } from './validation.js';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${key ?? '<missing>'}`);
    options[key.slice(2)] = value;
  }
  if (!['validate', 'reconcile'].includes(command)) throw new Error('Command must be validate or reconcile.');
  for (const required of ['input', 'config', 'output-dir', 'as-of']) {
    if (!options[required]) throw new Error(`Missing --${required}.`);
  }
  return { command, options };
}

async function loadSchema(name) {
  return JSON.parse(await readFile(resolve(packageRoot, 'contracts', name), 'utf8'));
}

export async function run(argv) {
  const { command, options } = parseArgs(argv);
  const outputDirectory = assertExplicitOutputDirectory(options['output-dir']);
  const snapshot = await readJson(resolve(options.input));
  const config = await readJson(resolve(options.config));
  const snapshotValidation = createValidator(await loadSchema('cpu-intake-snapshot.schema.json'))(snapshot);
  const configValidation = createValidator(await loadSchema('test-config.schema.json'))(config);
  const semantic = snapshotValidation.valid && configValidation.valid
    ? semanticSnapshotValidation(snapshot, config)
    : { valid: false, errors: [] };
  const errors = [
    ...snapshotValidation.errors.map((error) => ({ source: 'snapshot-schema', ...error })),
    ...configValidation.errors.map((error) => ({ source: 'config-schema', ...error })),
    ...semantic.errors.map((error) => ({ source: 'snapshot-semantics', ...error })),
  ];

  if (errors.length) {
    const quarantine = quarantineEvidence({ snapshot, errors, config, asOf: options['as-of'] });
    const file = `${quarantine.quarantineId.replace(':', '_')}.json`;
    const result = await preserveEvidence(safeOutputPath(outputDirectory, 'quarantine', file), quarantine);
    process.stdout.write(`${JSON.stringify({ outcome: 'rejected', evidence: result.path })}\n`);
    return 2;
  }

  if (options['as-of'] !== snapshot.scope.asOf) {
    const errors = [{ source: 'cli', keyword: 'asOf', message: '--as-of must exactly match snapshot.scope.asOf' }];
    const quarantine = quarantineEvidence({ snapshot, errors, config, asOf: options['as-of'] });
    const file = `${quarantine.quarantineId.replace(':', '_')}.json`;
    const result = await preserveEvidence(safeOutputPath(outputDirectory, 'quarantine', file), quarantine);
    process.stdout.write(`${JSON.stringify({ outcome: 'rejected', evidence: result.path })}\n`);
    return 2;
  }

  if (command === 'validate') {
    const validation = {
      evidenceType: 'fika.cpu-shadow.validation-evidence',
      evidenceVersion: '1.0.0',
      validationId: derivedId('validation', { snapshotId: snapshot.snapshotId, asOf: options['as-of'] }),
      snapshotId: snapshot.snapshotId,
      contract: snapshot.contract,
      configVersion: config.configVersion,
      producingOperationalLocationId: config.producingOperationalLocationId,
      intakeReference: config.intakeReference,
      asOf: options['as-of'],
      outcome: 'accepted',
    };
    const result = await preserveEvidence(
      safeOutputPath(outputDirectory, 'validation', `${validation.validationId.replace(':', '_')}.json`),
      validation,
    );
    process.stdout.write(`${JSON.stringify({ outcome: 'accepted', evidence: result.path })}\n`);
    return 0;
  }

  const evidence = reconcile(snapshot, config, options['as-of']);
  const result = await preserveEvidence(
    safeOutputPath(outputDirectory, 'reconciliation', `${evidence.evidenceExportId.replace(':', '_')}.json`),
    evidence,
  );
  process.stdout.write(`${JSON.stringify({ outcome: evidence.outcome, evidence: result.path, disposition: result.disposition })}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${basename(process.argv[1])}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
