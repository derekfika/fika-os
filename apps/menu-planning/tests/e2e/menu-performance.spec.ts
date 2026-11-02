import { test, expect } from "@playwright/test";
import { ROLLING_SLOTS } from "../../lib/rolling-menu-types";
import { categoriesForMenuSlot } from "../../lib/dish-categories";

test("108-entry planner: responsive typing, warm catalogue cache and no keypress requests or mutations",async({page},info)=>{
  test.setTimeout(90000);
  const baseline=process.env.MENU_PERF_BASELINE === "1";
  const days=["Monday","Tuesday","Wednesday","Thursday","Friday"].map((dayName,i)=>({id:`day:${i}`,dayName,date:`2099-01-${String(5+i).padStart(2,"0")}`,entryIds:[] as string[]}));
  const entries=days.flatMap(day=>ROLLING_SLOTS.map((slot,i)=>({id:`entry:${day.id}:${i}`,dayId:day.id,date:day.date,slot,itemId:`dish:${day.id}:${i}`,itemLabel:`${(Number(day.id.split(":")[1])*ROLLING_SLOTS.length+i)<26?["Recieve","Seperate","Accomodate"][i%3]:"Chickpea"} salad ${day.dayName} ${i}`,portions:12,allocations:[],allergens:{},audit:[]}))).slice(0,108);
  for(const day of days)day.entryIds=entries.filter(e=>e.dayId===day.id).map(e=>e.id);
  const week={id:"fixture-week:2099-01-05",version:1,status:"draft",dayIds:days.map(d=>d.id),entryIds:entries.map(e=>e.id),templateSlots:ROLLING_SLOTS,weekCommencing:days[0].date,weekEnding:"2099-01-11",sourceFiles:[],audit:[]};
  const secondWeek={...week,id:"fixture-week:2099-01-12",weekCommencing:"2099-01-12",weekEnding:"2099-01-18"};
  const catalogue=entries.map(e=>({id:e.itemId,displayName:e.itemLabel,category:categoriesForMenuSlot(e.slot)[0],item:{subcategory:e.slot.startsWith("SALAD")?"Leaf":undefined}}));
  catalogue.push(...Array.from({length:500-catalogue.length},(_,i)=>({id:`extra:${i}`,displayName:`Chickpea salad ${i}`,category:categoriesForMenuSlot(ROLLING_SLOTS[i%ROLLING_SLOTS.length])[0],item:{subcategory:"Leaf"}})));
  const dishReferences={schemaVersion:"menu-planning.dish-references.v1",weekId:week.id,weekVersion:week.version,byEntryId:Object.fromEntries(entries.slice(0,70).map(e=>[e.id,{entryId:e.id,requestedId:e.itemId,state:"active",classification:{category:categoriesForMenuSlot(e.slot)[0]==="Soup"?"Salad":"Soup"},provenance:{catalogueRevision:1,catalogueSourceHash:"synthetic-source"}}]))};
  const requests:{method:string;path:string}[]=[],errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(`globalThis.__name=fn=>fn;globalThis.__longTasks=[];globalThis.__inputPaint=[];globalThis.__openPaint=[];document.addEventListener('click',e=>{if(e.target instanceof Element&&e.target.closest('.week-menu-cell-button'))globalThis.__openStart=e.timeStamp},true);new MutationObserver(()=>{if(globalThis.__openStart&&document.querySelector('[role=dialog]')){const start=globalThis.__openStart;globalThis.__openStart=0;requestAnimationFrame(()=>requestAnimationFrame(()=>globalThis.__openPaint.push(performance.now()-start)))}}).observe(document,{childList:true,subtree:true});document.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)globalThis.__keyTime=e.timeStamp},true);document.addEventListener('input',e=>{if(!(e.target instanceof HTMLInputElement))return;const start=globalThis.__keyTime||performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>globalThis.__inputPaint.push(performance.now()-start)))},true);new PerformanceObserver(list=>{for(const e of list.getEntries())globalThis.__longTasks.push(e.duration)}).observe({entryTypes:['longtask']});`);
  await page.route(/^https:\/\//,r=>r.abort());
  await page.route("**/api/**",async route=>{
    const r=route.request(),url=new URL(r.url());requests.push({method:r.method(),path:url.pathname});
    if(r.method()!=="GET")return route.fulfill({status:409,json:{error:{message:"No fixture writes permitted"}}});
    if(url.pathname==="/api/spellcheck/dictionary")return route.continue();
    if(url.pathname==="/api/rolling-menu"){
      const selected=url.searchParams.get("weekId")?.includes("2099-01-12")?secondWeek:week;
      if(url.searchParams.has("summariesOnly"))return route.fulfill({json:{week:{id:selected.id,version:1},weeks:[week,secondWeek]}});
      return route.fulfill({headers:{"x-fika-menu-identity":"synthetic-perf-actor"},json:{snapshot:{week:selected,days,entries},weeks:[week,secondWeek],publicationState:{},dishReferences:{...dishReferences,weekId:selected.id},identity:"synthetic-perf-actor"}});
    }
    if(url.pathname==="/api/catalogue")return route.fulfill({headers:{"x-fika-menu-identity":"synthetic-perf-actor"},json:url.searchParams.has("manifest")?{schemaVersion:1,catalogueVersion:1,dishCount:catalogue.length}:{entries:catalogue,categories:["Salad"],identity:"synthetic-perf-actor",manifest:{schemaVersion:1,catalogueVersion:1,dishCount:catalogue.length}}});
    if(url.pathname==="/api/dish-tags")return route.fulfill({json:{version:1,tags:[],groups:[]}});
    return route.fulfill({json:{}});
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
  const navigationStart=Date.now();
  await page.goto("/?week=2099-01-05",{waitUntil:"networkidle"});
  await expect(page.getByText("108 dishes planned")).toBeVisible();
  await expect(page.getByLabel("26 suggestions",{exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByText("Reclassified",{exact:true})).toHaveCount(70);
  const coldInteractiveMs=Date.now()-navigationStart;
  await cdp.send("Profiler.enable");await cdp.send("Profiler.start");
  const cell=page.getByRole("button",{name:`Select ${entries[0].itemLabel}; drag or use Copy to day`,exact:true});
  const start=Date.now();await cell.click();const search=page.getByRole("textbox",{name:/Search .* dishes/});await expect(search).toBeVisible();const openMs=Date.now()-start;
  await page.evaluate(()=>{(window as any).__longTasks=[];});
  const requestCount=requests.length,latencies:number[]=[];
  for(const [i,char] of [..."chickpea x"].entries()){
    const started=Date.now();await search.press(char);await expect(search).toHaveValue("chickpea x".slice(0,i+1));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));latencies.push(Date.now()-started);
  }
  expect(requests.slice(requestCount)).toEqual([]);expect(requests.filter(r=>r.method!=="GET")).toEqual([]);
  const longTasks=await page.evaluate(()=>(window as any).__longTasks as number[]);
  const inputToPaintMs=await page.evaluate(()=>(window as any).__inputPaint as number[]);
  const cpuProfile=await cdp.send("Profiler.stop");
  await info.attach("picker-and-typing.cpuprofile",{body:JSON.stringify(cpuProfile.profile),contentType:"application/json"});
  await page.getByRole("button",{name:"Close dish picker",exact:true}).click();
  const reference=page.getByRole("button",{name:"Reclassified",exact:true}).first();
  await reference.click();await expect(reference).toHaveAttribute("aria-expanded","true");
  await reference.click();await expect(reference).toHaveAttribute("aria-expanded","false");
  await cell.click();await expect(search).toBeVisible();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await search.fill("new synthetic dish");await page.getByRole("button",{name:/Create “new synthetic dish”/}).click();
  await expect(page.getByRole("button",{name:"Cancel and close",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Cancel and close",exact:true}).click();await expect(search).toHaveValue("new synthetic dish");
  await page.getByRole("button",{name:"Close dish picker",exact:true}).click();
  const tagGets=requests.filter(r=>r.path==="/api/dish-tags").length;
  await page.getByRole("button",{name:/Check spelling/}).click();await expect(page.getByRole("dialog",{name:"Spelling suggestions"})).toBeVisible();await page.getByRole("button",{name:"Close spelling suggestions",exact:true}).click();
  await page.getByRole("button",{name:"Next week",exact:true}).click();
  await expect(page.getByText("WC 12 Jan 2099",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Previous week",exact:true}).click();
  await expect(page.getByText("WC 05 Jan 2099",{exact:true})).toBeVisible();
  const pickerClickToPaintMs=await page.evaluate(()=>(window as any).__openPaint);
  const beforeReload=requests.filter(r=>r.path==="/api/catalogue").length;
  const warmStart=Date.now();await page.reload({waitUntil:"networkidle"});await expect(page.getByText("108 dishes planned")).toBeVisible();
  const reloadCatalogueRequests=requests.filter(r=>r.path==="/api/catalogue").length-beforeReload;
  const warmInteractiveMs=Date.now()-warmStart;
  expect(errors).toEqual([]);
  const metrics={baseline,entries:108,catalogue:500,spellingFindings:26,reclassified:70,cpuThrottle:4,pickerClickToPaintMs,coldInteractiveMs,warmInteractiveMs,openMs,inputToPaintMs,keyToTwoFramesMs:latencies,longTasks,tagGets,reloadCatalogueRequests,posts:requests.filter(r=>r.method!=="GET").length};
  console.info("MENU_PERFORMANCE",JSON.stringify(metrics));await info.attach("performance.json",{body:JSON.stringify(metrics,null,2),contentType:"application/json"});
  if(!baseline){expect(reloadCatalogueRequests).toBe(0);expect(tagGets).toBe(1);expect(inputToPaintMs).toHaveLength(10);expect([...inputToPaintMs].sort((a,b)=>a-b)[5]).toBeLessThan(100);expect(Math.max(...inputToPaintMs)).toBeLessThan(350);}
  await page.screenshot({path:info.outputPath("108-entry-planner.png")});
});
