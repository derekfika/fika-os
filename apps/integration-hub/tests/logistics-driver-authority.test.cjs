const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { typescriptLoader } = require('../../../scripts/testing/load-typescript.cjs');
const appRoot = path.resolve(__dirname, '..');
const load = typescriptLoader({ typescript: require('typescript'), appRoot });
const { MemoryAuthModRepository } = load(path.join(appRoot, 'lib/authmod-core/memory-repository.ts'));
const { V1_APPLICATIONS } = load(path.join(appRoot, 'lib/authmod-core/model.ts'));
const { evaluateAuthority, resolvePermittedVehicleIds } = load(path.join(appRoot, 'lib/authmod-core/evaluator.ts'));
const { grantAuthority } = load(path.join(appRoot, 'lib/authmod-core/authority.ts'));
const { listLogisticsDrivers, resolveLogisticsDriver } = load(path.join(appRoot, 'lib/authmod-core/logistics-drivers.ts'));
const at = '2026-09-01T00:00:00Z';
function fixture() {
  const repo = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const identity = { id: 'person:driver', displayName: 'Governed Driver', identityKind: 'person', status: 'active', identityLinkStatus: 'matched', fullAccess: false, provenance: 'manual-override', version: 1, createdAt: at, updatedAt: at };
  repo.identities.set(identity.id, identity);
  repo.appAssignments.set('app:driver', { id: 'app:driver', identityId: identity.id, appId: 'logistics', status: 'active', version: 1, createdAt: at, updatedAt: at, source: 'manual-override' });
  const principal = { type: 'interactive', id: identity.id, displayName: identity.displayName, identityKind: 'person' };
  const grant = { id: 'grant:driver', subjectId: identity.id, subjectType: 'interactive', appId: 'logistics', resource: 'logistics.driver', action: 'Contribute', scope: { kind: 'resource', ids: ['van1'] }, status: 'active', provenance: 'explicit-special-authority', version: 1, createdAt: at, updatedAt: at };
  repo.grants.set(grant.id, grant);
  return { repo, identity, principal, grant };
}
test('fresh catalogue uses explicit driver grants without vehicle View', async () => {
  const { repo, principal } = fixture();
  assert.deepEqual(await resolvePermittedVehicleIds(repo, { principal }), { permittedVehicleIds: [], resolutionFailed: false });
  assert.deepEqual(await listLogisticsDrivers(repo), [{ driverId: principal.id, displayName: 'Governed Driver', permittedDriverVehicleIds: ['van1'] }]);
});
for (const [name, change] of [
  ['inactive', f => f.repo.identities.set(f.identity.id, { ...f.identity, status: 'inactive' })],
  ['revoked identity', f => f.repo.identities.set(f.identity.id, { ...f.identity, status: 'revoked' })],
  ['unmatched', f => f.repo.identities.set(f.identity.id, { ...f.identity, identityLinkStatus: 'unmatched' })],
  ['needs-review', f => f.repo.identities.set(f.identity.id, { ...f.identity, identityLinkStatus: 'needs-review' })],
  ['operational identity', f => f.repo.identities.set(f.identity.id, { ...f.identity, identityKind: 'operational' })],
  ['revoked grant', f => f.repo.grants.set(f.grant.id, { ...f.grant, status: 'revoked' })],
  ['expired grant', f => f.repo.grants.set(f.grant.id, { ...f.grant, effectiveTo: '2000-01-01T00:00:00Z' })],
  ['expired assignment', f => f.repo.appAssignments.set('app:driver', { ...f.repo.appAssignments.get('app:driver'), effectiveTo: '2000-01-01T00:00:00Z' })],
  ['Full Access without assignment', f => { f.repo.appAssignments.clear(); f.repo.identities.set(f.identity.id, { ...f.identity, fullAccess: true }); }],
  ['unknown vehicle', f => f.repo.grants.set(f.grant.id, { ...f.grant, scope: { kind: 'resource', ids: ['truck1'] } })],
  ['View-only', f => f.repo.grants.set(f.grant.id, { ...f.grant, resource: 'logistics.vehicle', action: 'View' })],
]) test(name + ' is excluded from new driver assignments', async () => {
  const f = fixture(); change(f);
  assert.equal(await resolveLogisticsDriver(f.repo, f.identity.id), undefined);
  assert.equal((await listLogisticsDrivers(f.repo)).length, 0);
});
test('both driver vehicles remain separate from access vehicles', async () => {
  const { repo, grant, principal } = fixture(); repo.grants.set(grant.id, { ...grant, scope: { kind: 'resource', ids: ['van1', 'van2'] } });
  assert.deepEqual((await resolveLogisticsDriver(repo, principal.id)).permittedDriverVehicleIds, ['van1', 'van2']);
  assert.deepEqual((await resolvePermittedVehicleIds(repo, { principal })).permittedVehicleIds, []);
});
test('grant service rejects operational driver and invalid driver scope', async () => {
  const { repo, identity, principal } = fixture();
  repo.identities.set(identity.id, { ...identity, identityKind: 'operational' });
  await assert.rejects(grantAuthority(repo, { subjectId: identity.id, subjectType: 'interactive', actor: principal, appId: 'logistics', resource: 'logistics.driver', action: 'Contribute', scope: { kind: 'resource', ids: ['van1'] }, reason: 'Reviewed driver eligibility' }), error => error.status === 422);
  await assert.rejects(grantAuthority(repo, { subjectId: identity.id, subjectType: 'interactive', actor: principal, appId: 'logistics', resource: 'logistics.driver', action: 'Contribute', scope: { kind: 'organisation', ids: [] }, reason: 'Reviewed driver eligibility' }), error => error.status === 422);
});
test('evaluator denies operational and unmatched drivers independently of catalogue', async () => {
  for (const patch of [{ identityKind: 'operational' }, { identityLinkStatus: 'unmatched' }]) {
    const { repo, identity, principal } = fixture(); repo.identities.set(identity.id, { ...identity, ...patch });
    assert.equal((await evaluateAuthority(repo, { principal, appId: 'logistics', resource: 'logistics.driver', action: 'Contribute', scope: { kind: 'resource', ids: ['van1'] } })).allowed, false);
  }
});
