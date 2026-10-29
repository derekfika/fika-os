import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'node:net';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fixture } from './lifecycle-fixture.mjs';
import { stateDir, save } from './runtime.mjs';
import { createWorkspace, finishWorkspace, workspaceRecords } from './workspaces.mjs';
import { beginWorkspaceOperation } from './workspace-state.mjs';
import { recoverDevOperation, assertDevPortsIdle } from './workspace-admin.mjs';

test('dev recovery preserves live, non-dev, mismatched and orphan-listener operations; exited recovery is audited before normal completion', async () => {
  const f = fixture();
  try { await f.within(async () => {
    const record = createWorkspace('dev-task', { owner: 'fixture-owner', scope: 'src' });
    const operation = beginWorkspaceOperation('dev', { workspace: record.name, owner: record.owner });
    // Read the generated marker so the lease identity is the actual registered one.
    const file = path.join(stateDir(), 'workspace-operations', readdirSync(path.join(stateDir(), 'workspace-operations'))[0]);
    const original = JSON.parse(readFileSync(file));
    const options = { reason: 'Fixture verified exited dev parent and no remaining listeners' };
    let inspectedPorts;
    const deps = { authorize: () => ({ login: 'fixture-admin', administrator: true }), processAlive: () => false, portsIdle: async ports => { inspectedPorts = ports; } };
    const recover = overrides => recoverDevOperation(original.id, options, { ...deps, ...overrides });
    await assert.rejects(recover({ authorize: () => ({ login: 'fixture-reader' }) }), /Administrator/);
    await assert.rejects(recoverDevOperation('../bad', options, deps), /operation id/);
    await assert.rejects(recoverDevOperation(original.id, { reason: '' }, deps), /reason/);
    await assert.rejects(recover({ processAlive: () => true }), /confirmed exited/);
    for (const kind of ['deploy', 'rollback', 'integrate', 'reconcile', 'validate']) {
      save(file, { ...original, kind });
      await assert.rejects(recover(), /confirmed exited/);
      assert.ok(existsSync(file));
    }
    save(file, { ...original, leaseId: 'different-lease' });
    await assert.rejects(recover(), /recorded workspace lease/);
    save(file, original);
    await assert.rejects(recover({ portsIdle: async () => { throw Error('orphan listener'); } }), /orphan listener/);
    let checks = 0;
    await assert.rejects(recover({ processAlive: () => ++checks > 1 }), /Dev process is live/);
    assert.ok(existsSync(file));
    assert.throws(() => finishWorkspace(record.name, { owner: record.owner }), /in-flight or interrupted/);
    const event = await recover();
    assert.deepEqual(inspectedPorts, Object.values(record.ports));
    assert.deepEqual(event.operation, original);
    const audit = JSON.parse(readFileSync(path.join(stateDir(), 'workspace-audit', `dev-recovery-${original.id}.json`)));
    assert.deepEqual(audit, event);
    assert.equal(existsSync(file), false);
    assert.equal(workspaceRecords()[0].state, 'active');
    finishWorkspace(record.name, { owner: record.owner });
    assert.equal(workspaceRecords()[0].state, 'finished');
    operation.end();
  }); } finally { f.dispose(); }
});

test('real port verification rejects an orphan listener and accepts it only after shutdown', async () => {
  const server = createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen({ port: 0, exclusive: true }, resolve));
  const port = server.address().port;
  try { await assert.rejects(assertDevPortsIdle([port]), /unavailable/); }
  finally { await new Promise(resolve => server.close(resolve)); }
  await assertDevPortsIdle([port]);
  for (const ports of [[], [0], [65536], [NaN]]) await assert.rejects(assertDevPortsIdle(ports), /missing or invalid/);
});
