import test from "node:test";
import assert from "node:assert/strict";
import { createDishTagClient } from "../lib/dish-tag-client";
const response = (version=1,status=200) => new Response(JSON.stringify({version,tags:[{id:`tag:${version}`,label:"Synthetic tag"}]}),{status});

test("picker and editor share one request and hot reads; TTL triggers version validation",async()=>{
  let calls=0,now=0;
  const client=createDishTagClient(async()=>{calls++;return response(calls);},()=>"synthetic:a",()=>now,50);
  const [a,b]=await Promise.all([client.load(),client.load()]);assert.equal(a,b);assert.equal(calls,1);
  assert.equal((await client.load()).version,1);assert.equal(calls,1);
  now=51;assert.equal((await client.load()).version,2);assert.equal(calls,2);
});
test("mutation invalidation defeats older in-flight responses and refetches the new registry",async()=>{
  let complete!:(value:Response)=>void,calls=0;
  const client=createDishTagClient(async()=>++calls===1?await new Promise<Response>(r=>{complete=r;}):response(2),()=>"synthetic:a");
  const old=client.load();client.invalidate(2);complete(response(1));await assert.rejects(old,/older|changed/);
  assert.equal((await client.load()).version,2);assert.equal(calls,2);
});
test("identity changes discard prior data/in-flight results; unidentified callers never share cached data",async()=>{
  let identity:string|undefined="synthetic:a",calls=0;
  const client=createDishTagClient(async()=>{calls++;return response();},()=>identity);
  await client.load();identity="synthetic:b";await client.load();assert.equal(calls,2);
  identity=undefined;await client.load();await client.load();assert.equal(calls,4);
});
test("errors are retried and a lower registry version is rejected instead of cached",async()=>{
  let version=3,status=503;
  const client=createDishTagClient(async()=>response(version,status),()=>"synthetic:a");
  await assert.rejects(client.load());status=200;assert.equal((await client.load()).version,3);
  client.invalidate();version=2;await assert.rejects(client.load(),/older/);
  version=4;assert.equal((await client.load()).version,4);
});
