/**
 * EMULATOR-ONLY rehearsal of the OAC catalogue plan. Seeds the isolated Firestore emulator from verified production
 * evidence, runs every planned governed command, and compares each OPLOC's effective catalogue before and after.
 * Refuses to run unless FIRESTORE_EMULATOR_HOST is loopback and the project id starts with "demo-". Never touches production.
 */
import fs from 'node:fs/promises';import path from 'node:path';
const host=process.env.FIRESTORE_EMULATOR_HOST||'',project=process.env.FIREBASE_PROJECT_ID||'';
if(!/^127\.0\.0\.1:\d+$/.test(host)||!project.startsWith('demo-'))throw new Error('Rehearsal runs only against a loopback Firestore emulator with a demo-* project.');
const {db}=await import('../lib/firebase-admin');
const {runCatalogueCommand}=await import('../lib/hospitality-catalogue-admin');
const {hospitalityPortalReadFromRecords}=await import('../lib/hospitality-catalogue-service');
const {listCanonicalRecordsByTypes}=await import('../lib/canonical-oplocs');
const [evidence,planFile,reportFile]=process.argv.slice(2);
if(!evidence||!planFile||!reportFile)throw new Error('Usage: oac-plan-rehearsal.ts EVIDENCE_DIR PLAN_JSON REPORT_JSON');
const read=async(f:string)=>JSON.parse((await fs.readFile(f,'utf8')).replace(/^\uFEFF/,''));
const source=await read(path.join(evidence,'live-catalogue-normalized.json'));
const OAC='oploc:24a93500-d75d-4fe0-8beb-672d36f9da10';
let seeded=0;
for(const key of ['Hospitality Menu Item','Hospitality Menu Offering','Hospitality Menu Price','OPLOC','integrationHubHospitalityMenuProductionRouting','integrationHubHospitalityMenuItemMerges','fikaDashboardQuoteSettings'])
  for(const d of source[key] as Array<Record<string,unknown>>){const {_path,_updateTime,...data}=d as {_path:string;_updateTime:string;[k:string]:unknown};await db.doc(_path).set(data);seeded++;}
const types=['Hospitality Menu Item','Hospitality Menu Offering','Hospitality Menu Price','OPLOC'];
const oplocs=(source['OPLOC'] as Array<any>).filter(o=>o.record.lifecycleState!=='archived'&&o.record.active!==false).map(o=>o.canonicalId as string);
const dates=['2026-10-26','2026-12-01'];
const snapshot=async()=>{const records=await listCanonicalRecordsByTypes(types) as never[];const out:Record<string,unknown>={};
  for(const o of oplocs)for(const date of dates)out[`${o}|${date}`]=hospitalityPortalReadFromRecords(records,{oplocId:o,serviceDate:date}).offerings;return out;};
const before=await snapshot();
const plan=await read(planFile);
const actor={uid:'test:rehearsal',name:'Rehearsal operator',role:'integration-admin' as const,synthetic:true};
const results:Array<{key:string;action:string;ok:boolean;message:string}>=[];
for(const e of plan.body.entries as Array<any>){if(!e.command)continue;
  try{const r=await runCatalogueCommand(actor,e.command);results.push({key:e.key,action:e.command.action,ok:true,message:r.message});}catch(x){results.push({key:e.key,action:e.command.action,ok:false,message:(x as Error).message});}}
const after=await snapshot();
const changedSites:string[]=[];for(const k of Object.keys(before)){if(JSON.stringify(before[k])!==JSON.stringify(after[k])&&!k.startsWith(OAC))changedSites.push(k);}
// idempotent replay of every create: no new documents
const countAll=async()=> (await db.collection('integrationHubCanonical').get()).size;
const n1=await countAll();const replay:Array<{key:string;ok:boolean;message:string}>=[];
for(const e of plan.body.entries as Array<any>){if(e.command?.action!=='create-item')continue;try{const r=await runCatalogueCommand(actor,e.command);replay.push({key:e.key,ok:true,message:r.message});}catch(x){replay.push({key:e.key,ok:false,message:(x as Error).message});}}
const n2=await countAll();
const oacAfter:Record<string,any[]>={};for(const d of dates)oacAfter[d]=after[`${OAC}|${d}`] as any[];
await fs.writeFile(reportFile,JSON.stringify({seeded,oplocsCompared:oplocs.length,dates,commandResults:results,otherSiteEffectiveChanges:changedSites,createReplay:replay,docCountBeforeReplay:n1,docCountAfterReplay:n2,oacOfferingCountBefore:(before[`${OAC}|${dates[0]}`] as any[]).length,oacOfferingCountAfter:oacAfter[dates[0]].length,oacEffective:oacAfter[dates[0]]},null,2));
console.log(JSON.stringify({seeded,commands:results.length,failed:results.filter(r=>!r.ok).length,otherSiteEffectiveChanges:changedSites.length,replayChangedDocs:n2-n1,replayFailures:replay.filter(r=>!r.ok).length}));
process.exit(0);
