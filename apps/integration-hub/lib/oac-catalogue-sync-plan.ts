import { createHash } from 'node:crypto';
import type { CatalogueCommand } from './hospitality-catalogue-admin';
export type CatalogueSyncEntry = { key: string; product: string; classification: 'update'|'create'|'correct'|'exclude'|'review'; command?: CatalogueCommand; businessApprovalRequired: boolean; routingApprovalRequired: boolean; /** New priced Item whose VAT treatment has no governed product classification yet. */ taxApprovalRequired?: boolean; reason?: string };
export const canonicalSyncBody = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalSyncBody) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonicalSyncBody(v)])) : value;
export const catalogueSyncHash = (body: unknown) => createHash('sha256').update(JSON.stringify(canonicalSyncBody(body))).digest('hex');
/** File-only preparation contract. No SDK, mutation runner, email or worker imports. */
export function prepareCatalogueSyncPlan(sourceStateHash: string, entries: CatalogueSyncEntry[], targetOplocId = "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10") {
  if(!/^[a-f0-9]{64}$/.test(sourceStateHash))throw new Error('A verified source-state hash is required.');
  if(new Set(entries.map(x=>x.key)).size!==entries.length)throw new Error('Duplicate sync action identity.');
  for(const e of entries){
    if(e.classification==='exclude'&&e.command)throw new Error('Excluded brochure rows are never creation commands.');
    if(e.command?.action==='create-item'&&(!e.command.restrictToSelectedOplocs||e.command.oplocIds.length!==1||e.command.oplocIds[0]!==targetOplocId))throw new Error('OAC creations require explicit single-site permanent scope.');
    if(e.command && 'oplocId' in e.command && e.command.oplocId!==targetOplocId)throw new Error('A site sync cannot mutate another OPLOC.');
    if(e.command&&['update-item','set-default-price','adopt-company-default','set-item-status','merge-items','set-routing'].includes(e.command.action))throw new Error('An OAC sync cannot modify shared defaults, history or routing.');
  }
  const body={targetOplocId,contract:'fika.oac-catalogue-sync-plan.v1',sourceStateHash,entries:structuredClone(entries),readyActions:entries.filter(e=>!e.businessApprovalRequired&&!e.routingApprovalRequired&&!e.taxApprovalRequired&&e.command).map(e=>({key:e.key,command:structuredClone(e.command!)})),holds:entries.filter(e=>e.businessApprovalRequired||e.routingApprovalRequired||e.taxApprovalRequired||e.classification==='review').map(e=>({key:e.key,business:e.businessApprovalRequired,routing:e.routingApprovalRequired,tax:!!e.taxApprovalRequired,reason:e.reason||'Decision required'}))};
  return {body,planHash:catalogueSyncHash(body),approved:false as const,applySupported:false as const};
}
export function verifyCatalogueSyncPlan(plan: ReturnType<typeof prepareCatalogueSyncPlan>, approvedPlanHash: string, currentSourceStateHash: string) {
  if(plan.planHash!==approvedPlanHash||catalogueSyncHash(plan.body)!==approvedPlanHash)throw new Error('Catalogue synchronisation plan changed.');
  if(plan.body.sourceStateHash!==currentSourceStateHash)throw new Error('Catalogue source state changed.');
  if(plan.body.holds.length)throw new Error('Unresolved catalogue decisions prevent full synchronisation.');
  return plan.body.readyActions;
}
