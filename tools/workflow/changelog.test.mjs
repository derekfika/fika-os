import test from 'node:test';
import assert from 'node:assert/strict';
import { assertChangelogs, changelogRequirements, assertChangelogContent } from './changelog.mjs';
import { affected } from './policy.mjs';
import { fixture } from './lifecycle-fixture.mjs';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

test('independent app PRs use their own index or unique fragments without root', () => {
  for (const app of ['logistics','cpu-production','ad-hoc-production']) {
    assert.doesNotThrow(() => assertChangelogs([`apps/${app}/lib/change.ts`, `.changes/${app}/2026-10-28-task-a.md`]));
    assert.doesNotThrow(() => assertChangelogs([`apps/${app}/lib/change.ts`, `apps/${app}/CHANGELOG.md`]));
    assert.throws(() => assertChangelogs([`apps/${app}/lib/change.ts`, 'CHANGELOG.md']), /Missing changelog/);
  }
});
test('multi-app changes require each app, while shared tooling uses platform entry', () => {
  const paths=['apps/logistics/lib/x.ts','apps/cpu-production/lib/x.ts','.changes/logistics/one.md'];
  assert.deepEqual(changelogRequirements(paths).missing,['cpu-production']);
  assert.doesNotThrow(() => assertChangelogs([...paths,'.changes/cpu-production/two.md']));
  assert.throws(() => assertChangelogs(['apps/shared/x.ts']), /platform/);
  assert.doesNotThrow(() => assertChangelogs(['tools/workflow/x.mjs','.changes/platform/workflow.md']));
});
test('documentation and read-only tasks have no entry requirement or app builds', () => {
  assert.equal(assertChangelogs([]).required,false);
  const docs=['apps/logistics/CHANGELOG.md','.changes/cpu-production/a.md','AGENTS.md'];
  assert.deepEqual(affected(docs).apps,[]);assert.equal(assertChangelogs(docs).required,false);
});
test('two agents can add distinct fragments to the same app without editing a shared file', () => {
  const app='apps/logistics/lib/work.ts';
  for (const id of ['agent-a-change','agent-b-change']) assert.doesNotThrow(() => assertChangelogs([app,`.changes/logistics/${id}.md`]));
  assert.deepEqual(affected(['.changes/logistics/agent-a-change.md']).apps,[]);
});
test('separate same-app fragments merge without root-log conflicts in real Git',()=>{
  const f=fixture();try{
    for(const branch of ['agent-a','agent-b']){
      f.git('checkout','-b',branch,'main');const dir=path.join(f.repo,'.changes','logistics');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,`${branch}.md`),`# 2026-10-28 — ${branch}\n\nIndependent change.\nValidation: fixture.\nDeployment: none.\n`);f.git('add','.');f.git('commit','-m',branch);
    }
    f.git('checkout','main');f.git('merge','--no-ff','agent-a','-m','Merge A');f.git('merge','--no-ff','agent-b','-m','Merge B');
    for(const name of ['agent-a','agent-b'])assert.ok(existsSync(path.join(f.repo,'.changes','logistics',`${name}.md`)));
    assert.ok(!existsSync(path.join(f.repo,'CHANGELOG.md')));
  }finally{f.dispose();}
});
test('deleted/empty fragments cannot satisfy CI',()=>{
  const p='.changes/logistics/fix.md';assert.throws(()=>assertChangelogContent([p],()=>{throw Error('missing');}),/deleted/);
  assert.throws(()=>assertChangelogContent([p],()=>''),/empty/);assert.throws(()=>assertChangelogContent([p],()=>('x'.repeat(100))),/dated title/);
});
