// Alternate full TS test entry point for hosts where tsx userInfo/IPC fails.
// Uses the existing diskless loader; source tests own their dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { typescriptLoader } = require('../../../scripts/testing/load-typescript.cjs');
const appRoot = path.resolve(__dirname, '..');
const directory = path.resolve(__dirname, '../tests');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.test.ts')).sort();
const selected = process.env.FIKA_DISKLESS_TEST_FILE;
if (selected) {
  if (!files.includes(selected)) throw new Error('Unknown test file.');
  const load = typescriptLoader({ typescript: require('typescript'), appRoot });
  load(path.join(directory, selected));
} else {
  // Preserve the standard runner's process isolation: Firebase initialization
  // and tests which alter environment/fetch must not leak to another test file.
  let tests = 0, passed = 0, failed = 0;
  for (const filename of files) {
    const result = spawnSync(process.execPath, ['--test', __filename], { encoding: 'utf8', env: { ...process.env, FIKA_DISKLESS_TEST_FILE: filename } });
    const output = (result.stdout || '') + (result.stderr || '');
    const count = key => Number(output.match(new RegExp('(?:#|ℹ) ' + key + ' (\\d+)'))?.[1] || 0);
    tests += count('tests'); passed += count('pass'); failed += count('fail');
    console.log(filename + ': ' + (result.status === 0 ? 'PASS' : 'FAIL') + ' (' + count('tests') + ' tests)');
    if (result.status !== 0) { console.log(output); process.exitCode = 1; }
  }
  console.log(JSON.stringify({ tests, passed, failed, skipped: 0 }));
}
