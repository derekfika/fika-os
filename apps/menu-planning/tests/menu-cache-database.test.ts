import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { openMenuCacheDatabase, setMenuCacheOpenTimeoutForTests } from "../lib/menu-cache-database";

test("real IndexedDB: common schema, both upgrade orders, v3 retention, isolation, warm hits and blocked upgrades", {skip:process.env.MENU_CACHE_BROWSER_TEST !== "1" ? "Run with MENU_CACHE_BROWSER_TEST=1 and installed test Chromium" : false}, async () => {
  const bundle = await build({ stdin:{contents:`import * as db from './lib/menu-cache-database'; import * as week from './lib/menu-week-cache'; import * as catalogue from './lib/menu-catalogue-cache'; Object.assign(window,{cacheTest:{...db,...week,...catalogue}});`,resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",format:"iife",define:{"process.env.NODE_ENV":'"test"'} });
  const server = createServer((_req,res)=>{res.end("<!doctype html><title>Isolated cache test</title>");});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address() as {port:number};
  const browser=await chromium.launch({headless:true});
  try {
    for(const version of [0,2,3]) for(const first of ["week","catalogue"]){
      const context=await browser.newContext();const page=await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);await page.addScriptTag({content:"globalThis.__name = fn => fn;\n"+bundle.outputFiles[0].text});
      const result=await page.evaluate(async ({version,first})=>{
        const h=(window as any).cacheTest;
        if(version)await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(h.MENU_CACHE_DATABASE,version);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("menuWeeks",{keyPath:"weekId"});d.createObjectStore("menuCatalogue",{keyPath:"cacheKey"});d.createObjectStore("cacheMetadata");};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(["menuWeeks","menuCatalogue","cacheMetadata"],"readwrite");t.objectStore("menuWeeks").put({weekId:"saved",identity:"actor-a",snapshot:{entries:[]},publicationState:{},version:7});t.objectStore("cacheMetadata").put({identity:"actor-a",weekId:"saved"},"selectedWeek");t.oncomplete=()=>{db.close();resolve();};};});
        if(first==="week")await h.getCachedWeek("saved","actor-a");else await h.getCachedCatalogue("synthetic-namespace");
        const saved=await h.getCachedWeek("saved","actor-a");
        sessionStorage.setItem("fika-menu-identity","actor-a");
        const ns=h.catalogueCacheNamespace();
        await h.putCachedCatalogue([{id:"canonical:synthetic",name:"Synthetic dish"}],ns,["Salad"],{schemaVersion:1,catalogueVersion:5});
        let fetches=0;const fetcher=async()=>{fetches++;return {entries:[],identity:"actor-a"};};
        const a=await h.loadCachedCatalogue(fetcher),b=await h.loadCachedCatalogue(fetcher);
        const other=await h.getCachedCatalogue(ns.replace("actor-a","actor-b"));
        sessionStorage.removeItem("fika-menu-identity");
        const unidentified=await h.getCachedCatalogue();
        const db=await h.openMenuCacheDatabase();const stores=[...db.objectStoreNames];const observedVersion=db.version;db.close();
        return {saved:Boolean(saved),fetches,ids:[a[0]?.id,b[0]?.id],other:Boolean(other),unidentified:Boolean(unidentified),stores,observedVersion};
      },{version,first});
      assert.equal(result.observedVersion,3);assert.deepEqual(result.stores,["cacheMetadata","menuCatalogue","menuWeeks"]);
      assert.equal(result.saved,version===3,`${version} / ${first}: existing v3 retained; old derived schemas invalidated`);
      assert.equal(result.fetches,0);assert.deepEqual(result.ids,["canonical:synthetic","canonical:synthetic"]);
      assert.equal(result.other,false);assert.equal(result.unidentified,false);
      await context.close();
    }
    const context=await browser.newContext(),page=await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);await page.addScriptTag({content:"globalThis.__name = fn => fn;\n"+bundle.outputFiles[0].text});
    const blocked=await page.evaluate(async()=>{
      const h=(window as any).cacheTest;
      const held=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(h.MENU_CACHE_DATABASE,2);r.onupgradeneeded=()=>r.result.createObjectStore("menuWeeks",{keyPath:"weekId"});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      held.onversionchange=()=>{};h.setMenuCacheOpenTimeoutForTests(100);
      const start=performance.now();const value=await h.getCachedWeek("none","actor-a");
      const cached=await h.getCachedCatalogue("namespace");held.close();
      return {elapsed:performance.now()-start,missing:value===undefined&&cached===undefined};
    });
    assert.equal(blocked.missing,true);assert.ok(blocked.elapsed<1500,"blocked upgrade must fail safely without sequential timeout stalls");
    await context.close();
  } finally {await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("both callers use one v3 schema; upgrade clears only legacy derived stores, existing v3 is untouched",async()=>{
  const original=globalThis.indexedDB;
  try {
    for(const oldVersion of [0,2,3]) {
      setMenuCacheOpenTimeoutForTests(100);
      const existing=new Set(oldVersion?["menuWeeks","menuCatalogue","cacheMetadata"]:[]),cleared:string[]=[],created:string[]=[];
      const db={objectStoreNames:{contains:(name:string)=>existing.has(name)},createObjectStore:(name:string)=>{created.push(name);existing.add(name);},close:()=>{}};
      globalThis.indexedDB={open:(name:string,version:number)=>{
        assert.equal(name,"fika-menu-planning");assert.equal(version,3);
        const r:any={result:db,transaction:{objectStore:(store:string)=>({clear:()=>cleared.push(store)})}};
        queueMicrotask(()=>{if(oldVersion<3)r.onupgradeneeded({oldVersion});r.onsuccess();});return r;
      }} as unknown as IDBFactory;
      await openMenuCacheDatabase();
      assert.equal(created.length,oldVersion===0?3:0);assert.equal(cleared.length,oldVersion===2?3:0);
    }
  } finally {globalThis.indexedDB=original;setMenuCacheOpenTimeoutForTests(3000);}
});
