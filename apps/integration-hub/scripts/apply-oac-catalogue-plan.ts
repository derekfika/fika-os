/**
 * Guarded production runner for the approved OAC catalogue plan.
 *
 *   preflight (default, read-only): verifies plan hash, VAT/hold state, live source fingerprint; saves a before-snapshot
 *   --apply   : runs every governed command in plan order, then publishes the catalogue package once
 *   --verify  : read-only comparison of every OPLOC's effective catalogue against the saved before-snapshot
 *
 * Usage: FIKA_RUNTIME_MODE=production FIREBASE_PROJECT_ID=fika-os FIKA_SNAPSHOT_BUCKET=... \
 *        tsx scripts/apply-oac-catalogue-plan.ts PLAN_JSON APPROVED_PLAN_HASH WORK_DIR [--apply|--verify]
 *
 * Idempotency: creates are replay-safe by request id; every command is also recorded in WORK_DIR/progress.jsonl and a
 * completed key is never run again. Execution stops at the first failure.
 */
import fs from 'node:fs/promises';import path from 'node:path';
const [planFile,approvedHash,workDir,mode='--preflight']=process.argv.slice(2);
if(!planFile||!approvedHash||!workDir||!['--preflight','--apply','--verify'].includes(mode))throw new Error('Usage: apply-oac-catalogue-plan.ts PLAN_JSON APPROVED_PLAN_HASH WORK_DIR [--preflight|--apply|--verify]');
if(process.env.FIKA_RUNTIME_MODE!=='production'||process.env.FIREBASE_PROJECT_ID!=='fika-os'||process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Production runner requires FIKA_RUNTIME_MODE=production, FIREBASE_PROJECT_ID=fika-os and no emulator.');
const {db}=await import('../lib/firebase-admin');
const {runCatalogueCommand}=await import('../lib/hospitality-catalogue-admin') as unknown as {runCatalogueCommand:(a:unknown,c:unknown)=>Promise<{itemIds:string[];message:string}>};
const {verifyCatalogueSyncPlan,catalogueSyncHash}=await import('../lib/oac-catalogue-sync-plan');
const {hospitalityPortalReadFromRecords}=await import('../lib/hospitality-catalogue-service');
const {listCanonicalRecordsByTypes}=await import('../lib/canonical-oplocs');
const {republishAfterMutation,getCataloguePackageManifest,getPublicCataloguePackageManifest}=await import('../lib/hospitality-catalogue-package');
const OAC='oploc:24a93500-d75d-4fe0-8beb-672d36f9da10';
const actor={uid:'release:oac-catalogue-2026-10-20',name:'OAC catalogue release (authorised by Derek Buckley; executed by Claude Code)',role:'integration-admin' as const,synthetic:false};
await fs.mkdir(workDir,{recursive:true});
const plan=JSON.parse((await fs.readFile(planFile,'utf8')).replace(/^﻿/,''));
if(plan.planHash!==approvedHash)throw new Error('Plan hash does not match the approved hash.');
if(plan.body.targetOplocId!==OAC)throw new Error('Plan target is not One Angel Court.');

/** Same normalisation as the evidence reader, so fingerprints are comparable. */
async function readLive(){
  const norm=(d:FirebaseFirestore.QueryDocumentSnapshot)=>({_path:d.ref.path,_updateTime:d.updateTime.toDate().toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),...d.data()});
  const out:Record<string,unknown>={};
  for(const t of ['Hospitality Menu Item','Hospitality Menu Offering','Hospitality Menu Price','OPLOC'])out[t]=(await db.collection('integrationHubCanonical').where('entityType','==',t).get()).docs.map(norm).sort((a,b)=>a._path.localeCompare(b._path));
  for(const c of ['integrationHubHospitalityMenuProductionRouting','integrationHubHospitalityMenuItemMerges','fikaDashboardQuoteSettings'])out[c]=(await db.collection(c).get()).docs.map(norm).sort((a,b)=>a._path.localeCompare(b._path));
  return out;
}
const dates=['2026-10-26','2026-12-01'];
async function effective(){
  const records=await listCanonicalRecordsByTypes(['Hospitality Menu Item','Hospitality Menu Offering','Hospitality Menu Price','OPLOC'],1000) as never[];
  const oplocs=(records as Array<{entityType:string;canonicalId:string;record:{lifecycleState?:string}}>).filter(r=>r.entityType==='OPLOC'&&r.record.lifecycleState!=='archived').map(r=>r.canonicalId).sort();
  const out:Record<string,unknown>={};
  for(const o of oplocs)for(const d of dates)out[`${o}|${d}`]=hospitalityPortalReadFromRecords(records,{oplocId:o,serviceDate:d}).offerings;
  return out;
}

if(mode==='--verify'){
  const before=JSON.parse(await fs.readFile(path.join(workDir,'effective-before.json'),'utf8'));const after=await effective();
  const changedOthers=Object.keys(before).filter(k=>!k.startsWith(OAC)&&JSON.stringify(before[k])!==JSON.stringify(after[k]));
  await fs.writeFile(path.join(workDir,'effective-after.json'),JSON.stringify(after));
  console.log(JSON.stringify({keysCompared:Object.keys(before).length,otherSiteChanges:changedOthers,oacOfferingsBefore:(before[`${OAC}|${dates[0]}`] as unknown[]).length,oacOfferingsAfter:(after[`${OAC}|${dates[0]}`] as unknown[]).length}));
  process.exit(changedOthers.length?2:0);
}

// ---------- preflight (also part of --apply) ----------
const live=await readLive();
const liveHash=catalogueSyncHash(live);
const ready=verifyCatalogueSyncPlan(plan,approvedHash,liveHash); // throws on tamper, drift or unresolved holds
const manifestsBefore={private:await getCataloguePackageManifest(),public:await getPublicCataloguePackageManifest()};
const before=await effective();
if(mode==='--preflight'){
  await fs.writeFile(path.join(workDir,'effective-before.json'),JSON.stringify(before));await fs.writeFile(path.join(workDir,'manifests-before.json'),JSON.stringify(manifestsBefore,null,2));
  console.log(JSON.stringify({preflight:'OK',planHash:plan.planHash,liveSourceHash:liveHash,commands:ready.length,manifestsBefore:{private:manifestsBefore.private?.contentHash,public:manifestsBefore.public?.contentHash,schema:manifestsBefore.private?.schemaVersion},oplocsCompared:Object.keys(before).length}));
  process.exit(0);
}

// ---------- apply ----------
try{await fs.access(path.join(workDir,'effective-before.json'));}catch{await fs.writeFile(path.join(workDir,'effective-before.json'),JSON.stringify(before));await fs.writeFile(path.join(workDir,'manifests-before.json'),JSON.stringify(manifestsBefore,null,2));}
const progressFile=path.join(workDir,'progress.jsonl');
const done=new Set<string>();try{for(const line of (await fs.readFile(progressFile,'utf8')).split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.ok)done.add(r.key);}}catch{/* first run */}
let applied=0;
for(const e of plan.body.entries as Array<{key:string;command?:unknown}>){
  if(!e.command||done.has(e.key))continue;
  try{const r=await runCatalogueCommand(actor,e.command);await fs.appendFile(progressFile,JSON.stringify({key:e.key,ok:true,itemIds:r.itemIds,message:r.message,at:new Date().toISOString()})+'\n');applied++;console.log('OK',e.key,r.message);}
  catch(error){await fs.appendFile(progressFile,JSON.stringify({key:e.key,ok:false,message:(error as Error).message,at:new Date().toISOString()})+'\n');console.error('FAILED',e.key,(error as Error).message);console.error('STOPPED: remaining commands not run. Firestore state is partially applied; package NOT republished.');process.exit(3);}
}
console.log(JSON.stringify({commandsAppliedThisRun:applied,previouslyApplied:done.size}));
const published=await republishAfterMutation();
const manifestsAfter={private:await getCataloguePackageManifest(),public:await getPublicCataloguePackageManifest()};
await fs.writeFile(path.join(workDir,'manifests-after.json'),JSON.stringify({published,manifestsAfter},null,2));
console.log(JSON.stringify({publication:published,private:{hash:manifestsAfter.private?.contentHash,version:manifestsAfter.private?.packageVersion,schema:manifestsAfter.private?.schemaVersion},public:{hash:manifestsAfter.public?.contentHash,version:manifestsAfter.public?.packageVersion}}));
process.exit(published==='stale'?4:0);
