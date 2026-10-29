const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ts = require('typescript');

test('shared Rotations schema resolves Zod types from the Hub app-only install', () => {
  const app = path.resolve(__dirname, '..');
  const configPath = path.join(app, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
  assert.deepEqual(parsed.errors, []);
  const source = path.resolve(app, '../shared/hospitality-rotations.ts');
  const expectedRoot = path.join(app, 'node_modules', 'zod') + path.sep;
  for (const specifier of ['zod', 'zod/v4']) {
    const result = ts.resolveModuleName(specifier, source, parsed.options, ts.sys).resolvedModule;
    assert.ok(result, `${specifier} must resolve from the shared contract`);
    assert.ok(path.resolve(result.resolvedFileName).startsWith(expectedRoot), result.resolvedFileName);
    assert.match(result.resolvedFileName, /\.d\.[cm]?ts$/);
  }
});
