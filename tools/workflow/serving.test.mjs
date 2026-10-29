import test from 'node:test';
import assert from 'node:assert/strict';
import { serving, backendPath } from './runtime.mjs';
import { target } from './policy.mjs';

const t = target('menu','staging');
const base = backendPath(t);
const sha = 'f'.repeat(40);
const trafficBuild = `projects/594727519934/locations/${t.region}/backends/${t.backend}/builds/build-001`;
function fixture({ direct = false, errorStatus = 404, mutate = () => {} } = {}) {
  const state = {
    traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:trafficBuild,percent:100}]}},
    build:{name:trafficBuild,state:'READY',reconciling:false,source:{codebase:{hash:sha}}},
    rollout:{name:`${base}/rollouts/${direct?'build-001':'rollout-001'}`,build:`${base}/builds/build-001`,state:'SUCCEEDED',reconciling:false},
  };
  mutate(state);
  const calls = [];
  const read = async resource => {
    calls.push(resource);
    if (resource === `${base}/traffic`) return structuredClone(state.traffic);
    if (resource === trafficBuild) return structuredClone(state.build);
    if (resource === `${base}/rollouts/build-001`) {
      if (direct) return structuredClone(state.rollout);
      throw Object.assign(Error('fixture inspection failure'),{status:errorStatus});
    }
    if (resource === `${base}/rollouts/rollout-001`) return structuredClone(state.rollout);
    if (resource === `${base}/rollouts?pageSize=100`) return {rollouts:[{name:`${base}/rollouts/other`,build:`${base}/builds/other`,state:'SUCCEEDED'}],nextPageToken:'second'};
    if (resource === `${base}/rollouts?pageSize=100&pageToken=second`) return {rollouts:[structuredClone(state.rollout)]};
    throw Error(`Unexpected fixture inspection ${resource}`);
  };
  return {state, calls, read};
}

test('serving retains the direct rollout fast path and verifies its actual build link',async()=>{
  const f=fixture({direct:true});
  assert.deepEqual(await serving(t,f.read),{sourceSha:sha,rollout:'build-001',state:'SUCCEEDED',percent:100});
  assert.equal(f.calls.length,3);
  assert.equal(f.calls.some(call=>call.includes('?')),false);
  const wrong=fixture({direct:true,mutate:s=>{s.rollout.build=`${base}/builds/other`;}});
  await assert.rejects(serving(t,wrong.read),/current traffic build/);
});

test('a distinct Firebase rollout ID is discovered across pages by exact build identity, including project ID/number aliases',async()=>{
  const f=fixture();
  assert.deepEqual(await serving(t,f.read),{sourceSha:sha,rollout:'rollout-001',state:'SUCCEEDED',percent:100});
  assert.ok(f.calls.some(call=>call.endsWith('pageToken=second')));
});

test('a discovered rollout name avoids repeated scans but its authoritative state is always rechecked',async()=>{
  const f=fixture();
  await serving(t,f.read);
  const discoveries=f.calls.filter(call=>call.includes('?')).length;
  await serving(t,f.read);
  assert.equal(f.calls.filter(call=>call.includes('?')).length,discoveries);
  f.state.rollout.state='FAILED';
  await assert.rejects(serving(t,f.read),/current traffic build/);
});

test('permission, service and transport failures never trigger missing-rollout fallback',async()=>{
  for(const errorStatus of [403,500,undefined]){
    const f=fixture({errorStatus});
    // An undefined status models a transport failure rather than a 404.
    const read=resource=>resource===`${base}/rollouts/build-001`&&errorStatus===undefined?Promise.reject(Error('transport')):f.read(resource);
    await assert.rejects(serving(t,read),/inspection failure|transport/);
    assert.equal(f.calls.some(call=>call.includes('?')),false);
  }
});

test('serving fails closed on scope, traffic, readiness and rollout contradictions',async()=>{
  for(const mutate of [
    s=>{s.traffic.rolloutPolicy.disabled=false;},
    s=>{s.traffic.reconciling=true;},
    s=>{s.traffic.current.splits[0].percent=50;},
    s=>{s.traffic.current.splits[0].build=trafficBuild.replace(t.backend,'other-backend');},
    s=>{s.build.state='FAILED';},
    s=>{s.build.reconciling=true;},
    s=>{s.build.name=trafficBuild.replace('594727519934','unrelated-project');},
    s=>{s.rollout.state='FAILED';},
    s=>{s.rollout.reconciling=true;},
    s=>{s.rollout.name=s.rollout.name.replace(t.backend,'other-backend');},
    s=>{s.rollout.build=s.rollout.build.replace('fika-os-dev','other-project');},
  ]){
    const f=fixture({mutate});
    await assert.rejects(serving(t,f.read));
  }
});

test('missing, ambiguous and incomplete rollout discovery never invents serving evidence',async()=>{
  for(const mode of ['missing','ambiguous','repeated-token']){
    const f=fixture();
    const read=async resource=>{
      if(!resource.includes('?'))return f.read(resource);
      if(mode==='missing')return {rollouts:[]};
      if(mode==='ambiguous')return {rollouts:[f.state.rollout,{...f.state.rollout,name:`${base}/rollouts/another`}]};
      return {rollouts:[],nextPageToken:'repeat'};
    };
    await assert.rejects(serving(t,read),/missing or ambiguous|Repeated/);
  }
});
