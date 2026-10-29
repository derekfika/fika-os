import test from 'node:test';
import assert from 'node:assert/strict';
import { readCreateAuditEvents } from './audit.mjs';
const t={project:'fika-os-dev',backend:'fika-hospitality-staging'};
const since=Date.parse('2026-10-29T17:32:49Z');
const response=body=>({ok:true,json:async()=>body});
test('Cloud audit reads scoped JSON with exhaustive pagination and never puts filter syntax in a shell',async()=>{
 const calls=[];let tokens=0;
 const result=await readCreateAuditEvents(t,since,{token:()=>{tokens++;return 'synthetic-test-token';},fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,options,body});
  return calls.length===1?response({entries:[],nextPageToken:'page-two'}):response({entries:[
   {timestamp:'now',protoPayload:{resourceName:'projects/p/locations/r/backends/fika-hospitality-staging/builds/b',methodName:'CreateBuild'}},
   {protoPayload:{resourceName:'projects/p/locations/r/backends/fika-hospitality-staging-other',methodName:'CreateRollout'}},
  ]});
 }});
 assert.deepEqual(result,{readable:true,events:[{at:'now',method:'CreateBuild'}]});assert.equal(tokens,1);assert.equal(calls.length,2);
 assert.equal(calls[0].url,'https://logging.googleapis.com/v2/entries:list');
 assert.equal(calls[0].options.method,'POST');assert.deepEqual(calls[0].body.resourceNames,['projects/fika-os-dev']);
 assert.match(calls[0].body.filter,/CreateRollout\|CreateBuild/);assert.match(calls[0].body.filter,/2026-10-29T17:32:49.000Z/);
 assert.equal(calls[1].body.pageToken,'page-two');
});
test('only an exhausted empty read proves no create calls',async()=>{
 assert.deepEqual(await readCreateAuditEvents(t,since,{token:()=>'',fetchImpl:async()=>response({})}),{readable:true,events:[]});
});
test('unreadable, truncated, looping, malformed or unavailable audit never proves empty',async()=>{
 for(const fetchImpl of [async()=>({ok:false}),async()=>{throw Error('network');},async()=>response({entries:'bad'}),async()=>response({nextPageToken:'loop'}),async()=>({ok:true,json:async()=>{throw Error('invalid json');}})]) {
  assert.deepEqual(await readCreateAuditEvents(t,since,{token:()=>'',fetchImpl}),{readable:false,events:[]});
 }
 assert.deepEqual(await readCreateAuditEvents(t,since,{token:()=>{throw Error('auth');}}),{readable:false,events:[]});
 assert.deepEqual(await readCreateAuditEvents(t,NaN),{readable:false,events:[]});
});
