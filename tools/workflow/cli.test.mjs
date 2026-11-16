import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './cli.mjs';

test('configuration-only deployment flags parse as an exact, explicit action',()=>{
  assert.deepEqual(parse(['deploy','hub','--prod','--config-only','--sha','a'.repeat(40),'--config-value','b'.repeat(64),'--execute','--approve-hash','c'.repeat(64)]),{
    positional:['deploy','hub'],options:{prod:true,'config-only':true,sha:'a'.repeat(40),'config-value':'b'.repeat(64),execute:true,'approve-hash':'c'.repeat(64)}
  });
  assert.throws(()=>parse(['deploy','hub','--prod','--clear-config','--config-value','b'.repeat(64)]),/Configuration values require/);
});
