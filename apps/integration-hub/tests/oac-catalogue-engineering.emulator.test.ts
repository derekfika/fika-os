import assert from 'node:assert/strict';import test from 'node:test';import {randomUUID}from'node:crypto';
import {db}from'../lib/firebase-admin';import{stableDocumentId}from'../lib/canonical-editor';import{runCatalogueCommand,type CatalogueCommand}from'../lib/hospitality-catalogue-admin';import{loadCatalogueRows}from'../lib/hospitality-catalogue-loader';import{hospitalityPortalReadFromRecords}from'../lib/hospitality-catalogue-service';import type{Actor}from'../lib/auth';
const enabled=process.env.FIKA_CATALOGUE_EMULATOR_TEST==='true'&&process.env.FIREBASE_PROJECT_ID==='demo-fika-os'&&process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8292';
const actor:Actor={uid:'test:catalogue',name:'Test operator',role:'integration-admin',synthetic:true};const stamp='2026-01-01T00:00:00Z';
async function site(id:string){await db.collection('integrationHubCanonical').doc(stableDocumentId(id)).set({canonicalId:id,entityType:'OPLOC',lifecycleStatus:'published',publicationStatus:'published',record:{canonicalId:id,approvedName:id,lifecycleState:'active'}});}
const get=async(id:string)=>(await db.collection('integrationHubCanonical').doc(stableDocumentId(id)).get()).data()!;
test('atomic OAC scoped creation, replay body binding, config override and future site protection; no operational writes',{skip:!enabled},async()=>{
 const operational=['fikaBookings','fikaBookingNotifications','fikaProductionOrdersV1','fikaDomainEventsV1','fikaDomainEventInboxV1','fikaFulfilmentRequirementsV1'];
 const beforeOperational=await Promise.all(operational.map(async c=>[c,(await db.collection(c).get()).docs.map(d=>({id:d.id,body:d.data()}))]));
 const tag=randomUUID().slice(0,8),oac='oploc:oac-'+tag,other='oploc:other-'+tag,future='oploc:future-'+tag;await site(oac);await site(other);
 const command:CatalogueCommand={action:'create-item',requestId:'oac-test-'+tag,name:'Test OAC '+tag,category:'Breakfast',defaultPrice:{amount:5,vatRate:.2},defaultMinimumQuantity:12,restrictToSelectedOplocs:true,oplocIds:[oac],routing:'cpu_hospitality',configuration:{servingInfo:'Per croissant',rules:{salesUnit:'croissant',productionConversion:{multiplier:1,unit:'croissant'},guestMinimumKind:'product'},choices:[]}};
 const first=await runCatalogueCommand(actor,command);const id=first.itemIds[0],before=await get(id);assert.deepEqual(before.record.allowedOplocIds,[oac]);const initialChildren=(await db.collection('integrationHubCanonical').where('record.hospitalityMenuItemId','==',id).get()).docs.map(x=>x.data());assert.equal(initialChildren.filter(x=>x.entityType==='Hospitality Menu Offering').length,0,'restricted Items create no Item-by-OPLOC exclusion matrix');await runCatalogueCommand(actor,command);assert.deepEqual(await get(id),before);
 await assert.rejects(runCatalogueCommand(actor,{...command,defaultPrice:{amount:1}}),/different|unverifiable/);
 const version=before.record.version;await runCatalogueCommand(actor,{action:'set-site-override',itemId:id,expectedVersion:version,oplocId:oac,minimumGuests:8,noticeRequiredDays:3,configuration:{rules:{guestMinimumKind:'product',noticeHours:72},servingInfo:'OAC per croissant'}});
 await assert.rejects(runCatalogueCommand(actor,{action:'set-site-override',itemId:id,expectedVersion:version,oplocId:oac,minimumQuantity:2}),/changed elsewhere/);
 await site(future);const rows=await loadCatalogueRows([id]);assert.deepEqual(rows[0].availableAt,[oac]);assert.ok(rows[0].unavailableAt.includes(future));
 const records=(await db.collection('integrationHubCanonical').get()).docs.map(x=>x.data())as never;assert.equal(hospitalityPortalReadFromRecords(records,{oplocId:future,serviceDate:'2026-11-16'}).offerings.some((x:any)=>x.itemId===id),false);
 assert.equal((await get(id)).record.defaultMinimumQuantity,12);assert.equal((await get(id)).record.configuration.servingInfo,'Per croissant');
 const audit=await db.collection('integrationHubGovernanceAudit').where('entityReference','==',id).get();assert.equal(audit.size,2,'one create and one override; replay does not duplicate evidence');
 const afterOperational=await Promise.all(operational.map(async c=>[c,(await db.collection(c).get()).docs.map(d=>({id:d.id,body:d.data()}))]));
 assert.deepEqual(afterOperational,beforeOperational,'catalogue mutations create no booking, notification, production, domain or fulfilment effects');
});
test('quote-only config/starting price, per-variety schema and parent validation use real governed transaction',{skip:!enabled},async()=>{
 const tag=randomUUID().slice(0,8),oac='oploc:cake-'+tag;await site(oac);const create:CatalogueCommand={action:'create-item',requestId:'cake-'+tag,name:'Test cake '+tag,category:'Sweet treats',offeringMode:'quote_only',oplocIds:[oac],restrictToSelectedOplocs:true,routing:'cpu_hospitality',configuration:{serves:12,rules:{indicativeFrom:27,noticeHours:72}}};const id=(await runCatalogueCommand(actor,create)).itemIds[0];assert.equal((await get(id)).record.defaultOfferingMode,'quote_only');
 await assert.rejects(runCatalogueCommand(actor,{...create,requestId:'bad-'+tag,name:'Invalid '+tag,defaultPrice:{amount:27}}),/purchase price/);
 await assert.rejects(runCatalogueCommand(actor,{action:'set-site-override',itemId:id,expectedVersion:1,oplocId:oac,configuration:{rules:{parentItemId:id}}}),/itself|base package/);
 const v=(await get(id)).record.version;await assert.rejects(runCatalogueCommand(actor,{action:'set-site-override',itemId:id,expectedVersion:v,oplocId:oac,price:{amount:20}}),/purchase price|cannot have/);assert.equal((await get(id)).record.version,v);
});
