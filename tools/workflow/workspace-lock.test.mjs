import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installWorkspaceMutexSentinel, withWorkspaceMutex } from './workspace-lock.mjs';

const mutexUrl = new URL('./workspace-lock.mjs', import.meta.url).href;
const childSource = `
import { writeSync } from 'node:fs';
import { withWorkspaceMutex } from ${JSON.stringify(mutexUrl)};
try {
  withWorkspaceMutex(process.argv[1], () => {
    writeSync(1, 'entered\\n');
    if (process.argv[2] === 'hold') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  }, { timeoutMs: 100 });
} catch (error) {
  writeSync(2, error.code + '\\n');
  process.exitCode = 1;
}
`;

function fixture(t) {
  const temp = path.resolve(os.tmpdir());
  const directory = mkdtempSync(path.join(temp, 'fika-workspace-mutex-'));
  t.after(() => {
    assert.equal(path.dirname(directory), temp);
    assert.match(path.basename(directory), /^fika-workspace-mutex-/);
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('legacy exclusion refuses a prior lock and keeps the legacy path reserved after cutover', t => {
  const directory = fixture(t);
  const legacy = path.join(directory, 'workspaces.lock');
  assert.throws(() => withWorkspaceMutex(directory, () => assert.fail()), { code: 'WORKSPACE_MUTEX_LEGACY' });
  writeFileSync(legacy, '');
  assert.throws(() => installWorkspaceMutexSentinel(directory), { code: 'WORKSPACE_MUTEX_LEGACY' });
  assert.equal(readFileSync(legacy, 'utf8'), '');
  writeFileSync(legacy, 'unrecognized sentinel');
  assert.throws(() => withWorkspaceMutex(directory, () => assert.fail()), { code: 'WORKSPACE_MUTEX_LEGACY' });

  const cutover = fixture(t);
  installWorkspaceMutexSentinel(cutover);
  const oldWriter = spawnSync(process.execPath, ['-e', "require('node:fs').openSync(process.argv[1], 'wx')", path.join(cutover, 'workspaces.lock')], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(oldWriter.status, 1);
  assert.match(oldWriter.stderr, /EEXIST/);
  assert.deepEqual(readdirSync(cutover), ['workspaces.lock']);
  // A crash after publishing the link can leave the temporary name behind.
  linkSync(path.join(cutover, 'workspaces.lock'), path.join(cutover, 'workspace-mutex-fixture.pending'));
  assert.equal(withWorkspaceMutex(cutover, () => 'admitted'), 'admitted');
});

test('separate processes serialize and forced death releases the mutex', async t => {
  const directory = fixture(t);
  installWorkspaceMutexSentinel(directory);
  const args = ['--input-type=module', '-e', childSource, directory];
  const holder = spawn(process.execPath, [...args, 'hold'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(holder, 'exit');
  let stderr = '';
  holder.stderr.on('data', data => { stderr += data; });
  try {
    const ready = once(holder.stdout, 'data').then(([data]) => data.toString());
    const earlyExit = exited.then(() => { throw Error('Holder exited before taking the mutex: ' + stderr); });
    assert.match(await Promise.race([ready, earlyExit]), /^entered/);
    const blocked = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.equal(blocked.stdout, '');
    assert.match(blocked.stderr, /WORKSPACE_MUTEX_BUSY/);
    holder.kill('SIGKILL');
    await exited;
    const next = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /^entered/);
    assert.ok(readdirSync(directory).includes('workspaces.lock'));
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
    await exited;
  }
});

test('callback errors release the mutex and asynchronous callbacks are refused', t => {
  const directory = fixture(t);
  installWorkspaceMutexSentinel(directory);
  assert.throws(() => withWorkspaceMutex(directory, () => { throw Error('callback failed'); }), /callback failed/);
  assert.throws(() => withWorkspaceMutex(directory, async () => assert.fail()), /synchronous callback/);
  assert.equal(withWorkspaceMutex(directory, () => 42), 42);
});

test('corrupt storage is distinct from a busy holder and leaves the evidence in place', t => {
  const directory = fixture(t);
  installWorkspaceMutexSentinel(directory);
  const database = path.join(directory, 'workspace-mutex.sqlite');
  const damaged = Buffer.alloc(4096, 0x61);
  writeFileSync(database, damaged);
  assert.throws(() => withWorkspaceMutex(directory, () => assert.fail()), { code: 'WORKSPACE_MUTEX_STORAGE' });
  assert.deepEqual(readFileSync(database), damaged);
});

test('a runtime with SQLite disabled refuses the V2 sentinel', t => {
  const directory = fixture(t);
  installWorkspaceMutexSentinel(directory);
  const blocked = spawnSync(process.execPath, ['--no-experimental-sqlite', '--input-type=module', '-e', childSource, directory], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.equal(blocked.stdout, '');
  assert.match(blocked.stderr, /WORKSPACE_MUTEX_UNSUPPORTED/);
});
