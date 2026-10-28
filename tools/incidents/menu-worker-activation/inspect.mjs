// Read-only, bounded incident inspection. Never print credentials or request headers.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const auth = spawnSync('gcloud auth print-access-token --quiet', { shell: true, windowsHide: true, encoding: 'utf8' });
if (auth.status !== 0) throw Error('Read authentication unavailable');
const headers = { Authorization: `Bearer ${auth.stdout.trim()}`, 'content-type': 'application/json' };
const base = 'https://firestore.googleapis.com/v1/projects/fika-os/databases/(default)/documents';
async function read(path, body) {
  const response = await fetch(`${base}${path}`, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Read failed ${response.status}`);
  return response.json();
}
function decode(v) {
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('integerValue' in v) return Number(v.integerValue);
  return Object.values(v)[0];
}
const record = document => document ? decode({ mapValue: { fields: document.fields || {} } }) : null;
async function query(collection, field, value) {
  const rows = await read(':runQuery', { structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, limit: 201 } });
  const docs = rows.filter(row => row.document).map(row => row.document);
  if (docs.length === 201) throw Error('Inspection exceeded its bound; scope further before continuing');
  return docs;
}
const results = [];
for (const date of ['2026-10-26', '2026-11-02']) {
  const publicationId = `menu-publication:rolling-week:${date}`;
  const [eventDocs, orderDocs] = await Promise.all([query('fikaMenuPlanningEvents', 'payload.publicationId', publicationId), query('fikaProductionOrdersV1', 'sourcePublicationId', publicationId)]);
  const events = eventDocs.map(record), orders = orderDocs.map(record);
  const plans = await Promise.all(orders.map(order => read(`/fikaCpuProductionPlansV1/${encodeURIComponent(order.canonicalId)}`).then(record)));
  const cpuWeek = record(await read(`/fikaCpuProductionDayProjectionsV1/week:${date}`));
  const canonicalIds = new Set(orders.map(order => order.canonicalId));
  const projectedIds = new Set((cpuWeek?.orders || []).map(order => order.id));
  const cpuProjection = { present: Boolean(cpuWeek), revision: cpuWeek?.revision, matchingOrders: [...canonicalIds].filter(id => projectedIds.has(id)).length, missingOrderIds: [...canonicalIds].filter(id => !projectedIds.has(id)) };
  const checks = { checkedOrders: 0, checkedLines: 0, portions: 0, errors: [] };
  if (date === '2026-11-02') for (const event of events.filter(event => event.eventType === 'production.materialise')) {
    const expected = event.payload;
    const order = orders.find(order => order.sourceEntityId === expected.sourceEntityId && order.destinationOplocId === expected.destinationOplocId);
    if (!order) { checks.errors.push(`Missing order for ${event.eventId}`); continue; }
    checks.checkedOrders++;
    if (order.sourceContentHash !== expected.sourceContentHash || order.sourcePublicationDayId !== expected.sourcePublicationDayId || order.sourceVersion !== expected.sourceVersion || order.serviceDate !== expected.serviceDate || order.version !== 1) checks.errors.push(`Order lineage/version mismatch: ${order.canonicalId}`);
    if (order.lines.length !== expected.lines.length) checks.errors.push(`Order line count mismatch: ${order.canonicalId}`);
    for (const line of expected.lines) {
      const actual = order.lines.find(actual => actual.sourceBookingLineId === line.sourceLineId);
      checks.checkedLines++; checks.portions += line.quantity;
      if (!actual || actual.sourceMenuItemId !== line.canonicalItemId || actual.customerQuantity !== line.quantity || actual.productionQuantity !== line.quantity || actual.customerUnit !== line.unit || actual.productionUnit !== line.unit || !isDeepStrictEqual(actual.approvedAllergenSnapshot, line.approvedAllergenSnapshot) || actual.allergenEvidenceStatus !== line.approvedAllergenSnapshot?.allergenEvidenceStatus) checks.errors.push(`Quantity/identity/allergen mismatch: ${line.sourceLineId}`);
      const projected = (cpuWeek?.orders || []).find(projected => projected.id === order.canonicalId)?.quantities.find(projected => projected.sourceBookingLineId === line.sourceLineId);
      if (!projected || projected.quantity !== line.quantity || projected.unit !== line.unit || !isDeepStrictEqual(projected.approvedAllergenSnapshot, line.approvedAllergenSnapshot)) checks.errors.push(`CPU line mismatch: ${line.sourceLineId}`);
    }
  }
  const sites = [...new Set(events.map(event => event.payload?.destinationOplocId).filter(Boolean))];
  const indexes = await Promise.all(sites.map(async site => {
    const key = createHash('sha256').update(`${site}:${date}`).digest('hex');
    const head = record(await read(`/fikaDeliveredInProjectionIndexHeadsV1/${key}`));
    const entries = (head?.entries || []).filter(entry => entry.publicationId === publicationId);
    if (date === '2026-11-02') for (const event of events.filter(event => event.eventType === 'production.materialise' && event.payload.destinationOplocId === site)) {
      const expected = event.payload;
      const entry = entries.find(entry => entry.serviceDate === expected.serviceDate);
      if (!entry || entry.freshness !== 'current' || entry.state !== 'available' || !entry.sourceLineageKey?.startsWith([publicationId, expected.sourcePublicationDayId, expected.sourceVersion, expected.sourceContentHash].join('|'))) checks.errors.push(`Delivered-In lineage/freshness mismatch: ${site}:${expected.serviceDate}`);
    }
    return { site, present: Boolean(head), entries: entries.map(({ serviceDate, freshness, completeness, state }) => ({ serviceDate, freshness, completeness, state })) };
  }));
  results.push({ publicationId, events: events.map(event => ({ id: event.eventId, type: event.eventType, status: event.delivery.status, attempts: event.delivery.attempts, error: event.delivery.lastError })), orders: orders.map(order => ({ id: order.canonicalId, date: order.serviceDate, version: order.version, sourceVersion: order.sourceVersion, lines: order.lines?.length })), cpuPlansPresent: plans.filter(Boolean).length, cpuProjection, checks, deliveredIn: indexes });
}
const evidence = { observedAt: new Date().toISOString(), results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2));
if (results.some(result => result.checks.errors.length)) process.exitCode = 1;
console.log(JSON.stringify({ observedAt: evidence.observedAt, publications: results.map(result => ({ publicationId: result.publicationId, events: result.events.reduce((counts, event) => ({ ...counts, [event.status]: (counts[event.status] || 0) + 1 }), {}), errors: result.events.filter(event => event.status === 'failed' || event.status === 'dead-letter').map(({ id, attempts, error }) => ({ id, attempts, error })), orders: result.orders.length, cpuPlansPresent: result.cpuPlansPresent, cpuProjection: result.cpuProjection, checks: result.checks, deliveredInSitesPresent: result.deliveredIn.filter(site => site.present).length, deliveredInDays: result.deliveredIn.flatMap(site => site.entries).length })) }, null, 2));
