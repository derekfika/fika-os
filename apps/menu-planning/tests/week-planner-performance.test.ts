import test from "node:test";
import assert from "node:assert/strict";
import { plannerCopyAvailability, memoizePlannerSpeller } from "../lib/planner-copy-availability";
import { compatibleDishCopyTargets, copyableDishForSource } from "../lib/dish-copy";
import { ROLLING_SLOTS, type RollingSnapshot } from "../lib/rolling-menu-types";
import { categoriesForMenuSlot } from "../lib/dish-categories";

export function performanceFixture() {
  const days=["Monday","Tuesday","Wednesday","Thursday","Friday"].map((dayName,i)=>({id:`day:${i}`,dayName,date:`2099-01-${5+i}`,entryIds:[] as string[]}));
  const entries=days.flatMap(day=>ROLLING_SLOTS.map((slot,i)=>({id:`entry:${day.id}:${i}`,dayId:day.id,date:day.date,slot,itemId:`dish:${day.id}:${i}`,itemLabel:`Synthetic dish ${i}`,portions:12,allocations:[],allergens:{},audit:[]}))).slice(0,108);
  const dishes=entries.map(e=>({id:e.itemId,name:e.itemLabel,category:categoriesForMenuSlot(e.slot)[0]}));
  const snapshot={week:{id:"synthetic-week",version:1,status:"draft",dayIds:days.map(d=>d.id),entryIds:entries.map(e=>e.id),weekCommencing:days[0].date,weekEnding:"2099-01-11",sourceFiles:[],audit:[]},days,entries} as RollingSnapshot;
  return {snapshot,dishes,slots:[...ROLLING_SLOTS]};
}

test("indexed copy availability matches existing assessments without repeated source/target entry scans",()=>{
  const {snapshot,dishes,slots}=performanceFixture();
  for(const variant of ["draft","published","locked-day","conflicting-cell","blank-with-evidence","archived-dish"]){
    const s=structuredClone(snapshot),d=structuredClone(dishes);
    if(variant==="published")s.week.status="published";
    if(variant==="locked-day")s.week.dayStatuses={[s.days[4].id]:"published"};
    if(variant==="conflicting-cell")s.entries.push({...s.entries[0],id:"conflict"});
    if(variant==="blank-with-evidence")s.entries.push({...s.entries[0],id:"blank-evidence",dayId:s.days[4].id,slot:"DESSERT 3",itemId:"",itemLabel:"",portions:0,allergens:{milk:"contains"}});
    if(variant==="archived-dish")d.splice(0,1);
    const before=JSON.stringify(s),indexes=plannerCopyAvailability(s,d,slots);
    for(const entry of s.entries){assert.equal(indexes.available.has(entry.id),compatibleDishCopyTargets(s,d,entry.id,slots).length>0,`${variant}: ${entry.id}`);assert.deepEqual(indexes.copyableByEntry.get(entry.id),copyableDishForSource(s,d,entry.id));}
    assert.equal(JSON.stringify(s),before,"derived indexes must not mutate historical/operational state");
  }
});

test("dictionary-instance cache avoids repeated suggestions and cannot leak modified results or older dictionary revisions",()=>{
  let checks=0,suggests=0;
  const raw={correct:()=>{checks++;return false;},suggest:()=>{suggests++;return ["receive"];}};
  const cached=memoizePlannerSpeller(raw);
  for(let i=0;i<108;i++){assert.equal(cached.correct("recieve"),false);const suggestions=cached.suggest("recieve");suggestions.push("tampered");assert.deepEqual(cached.suggest("recieve"),["receive"]);}
  assert.equal(checks,1);assert.equal(suggests,1);
  const next=memoizePlannerSpeller({correct:()=>true,suggest:()=>[]});assert.equal(next.correct("recieve"),true);assert.deepEqual(next.suggest("recieve"),[]);
});

test("108-entry render work: remove all per-cell target enumeration and linear entry lookups",()=>{
  const f=performanceFixture();let scans=0;
  f.snapshot.entries=new Proxy(f.snapshot.entries,{get(target,key,receiver){if(key==="find"||key==="filter")scans++;return Reflect.get(target,key,receiver);}});
  const start=performance.now();for(const e of f.snapshot.entries)compatibleDishCopyTargets(f.snapshot,f.dishes,e.id,f.slots);const oldMs=performance.now()-start,oldScans=scans;
  scans=0;const next=performance.now();plannerCopyAvailability(f.snapshot,f.dishes,f.slots);const newMs=performance.now()-next;
  assert.ok(oldScans>1000);assert.equal(scans,0);
  console.info("Synthetic 108-entry copy-render comparison",{oldMs,newMs,oldScans,newScans:scans});
});
