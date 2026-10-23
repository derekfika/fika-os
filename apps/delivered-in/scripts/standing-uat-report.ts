/**
 * READ-ONLY Grab & Go standing-order preflight and UAT report. It performs Firestore reads only: no set/create/update/delete,
 * no HTTP calls, no scheduler access. Run with operator Application Default Credentials against the intended project.
 *
 *   npx tsx scripts/standing-uat-report.ts census  --project <gcp-project>
 *   npx tsx scripts/standing-uat-report.ts report  --project <gcp-project> --oploc oploc:<id> --date YYYY-MM-DD
 *
 * census: classifies every document in the standing-order collection (bounded to 500) so a release can prove no existing
 *         record uses the v2 shape or collides with the v2 document ids.
 * report: for one OPLOC/delivery date prints the Delivered-In order (product ids, quantities, rotation week, source version,
 *         control), its handoff outbox events, the Hub Production Order and the Fulfilment Requirement Logistics consumes.
 */
import crypto from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const argument = (name: string) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : undefined; };
const command = process.argv[2]; const project = argument("project");
if (!["census", "report"].includes(command) || !project) { console.error("Usage: standing-uat-report.ts census|report --project <gcp-project> [--oploc <id> --date <YYYY-MM-DD>]"); process.exit(2); }
if (process.env.FIRESTORE_EMULATOR_HOST === undefined && /(emulator|local)/i.test(project)) { console.error("Refusing: project name looks like an emulator but no emulator host is set."); process.exit(2); }
const app = getApps()[0] || initializeApp({ projectId: project }); const db = getFirestore(app);
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const STANDING = "fikaDeliveredInGrabAndGoStandingOrdersV1", ORDERS = "fikaDeliveredInGrabAndGoOrdersV1", HANDOFF = "fikaDeliveredInGrabAndGoHandoffV1", PRODUCTION = "fikaProductionOrdersV1", FULFILMENT = "fikaFulfilmentRequirementsV1";
const safe = (value: string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");

async function census() {
  const snapshot = await db.collection(STANDING).limit(500).get();
  const counts: Record<string, number> = {}; const collisions: string[] = [];
  for (const document of snapshot.docs) {
    const data = document.data(); const kind = data.schemaVersion === 2 && ["head", "version", "operation"].includes(data.recordType) ? `v2-${data.recordType}` : data.schemaVersion === undefined && data.standingOrderId ? "legacy" : "unrecognised";
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === "legacy") { const v2Head = sha(`grab-and-go-standing:v2:${data.oplocId}`); if (document.id === v2Head) collisions.push(document.id); }
    if (kind === "unrecognised") collisions.push(`${document.id} (unrecognised shape)`);
  }
  console.log(JSON.stringify({ project, collection: STANDING, scanned: snapshot.size, truncated: snapshot.size === 500, counts, collisions, verdict: collisions.length ? "REVIEW BEFORE RELEASE" : "no existing record uses or collides with the v2 schema" }, null, 2));
}

async function report() {
  const oploc = argument("oploc"), date = argument("date");
  if (!oploc?.startsWith("oploc:") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { console.error("--oploc oploc:<canonical id> and --date YYYY-MM-DD are required."); process.exit(2); }
  const standingId = `grab-and-go-standing:v2:${oploc}`; const orderId = `grab-and-go:${oploc}:${date}`;
  const head = (await db.collection(STANDING).doc(sha(standingId)).get()).data();
  const versions = (await db.collection(STANDING).where("recordType", "==", "version").where("oplocId", "==", oploc).orderBy("version", "desc").limit(10).get()).docs.map(doc => { const data = doc.data(); return { version: data.version, action: data.action, status: data.status, actor: data.actor, at: data.at, changedSlots: data.changedSlots }; });
  const order = (await db.collection(ORDERS).doc(sha(orderId)).get()).data();
  const events: unknown[] = [];
  if (order) for (let version = 1; version <= order.version; version += 1) { const event = (await db.collection(HANDOFF).doc(sha(`production.materialise:${orderId}:v${version}`)).get()).data(); events.push(event ? { version, status: event.status || event.delivery?.status, delivery: event.delivery?.status, attempts: event.delivery?.attempts, lines: event.payload?.lines?.map((line: any) => `${line.canonicalItemId}×${line.quantity}`) } : { version, missing: true }); }
  const productionId = `production-order:v1:grab-and-go:${safe(orderId)}:${safe(oploc)}`;
  const production = (await db.collection(PRODUCTION).doc(sha(productionId)).get()).data();
  const requirements = (await db.collection(FULFILMENT).where("serviceDate", "==", date).limit(200).get()).docs.map(doc => doc.data()).filter(item => item.sourceEntityId === orderId);
  const lineSummary = (lines: any[] = []) => lines.map(line => `${line.canonicalItemId || line.sourceMenuItemId || line.sourceLineId}×${line.quantity ?? line.productionQuantity ?? line.customerQuantity}`);
  console.log(JSON.stringify({
    project, oploc, date, standingOrder: head && { status: head.status, version: head.version, cycle: head.cycle, slots: head.slots },
    standingVersions: versions,
    deliveredInOrder: order && { orderId: order.orderId, status: order.status, version: order.version, rotationWeek: order.rotationWeek, control: order.control, source: order.source, updatedBy: order.updatedBy, lines: lineSummary(order.lines.map((line: any) => ({ canonicalItemId: line.productId, quantity: line.quantity }))) },
    handoffEvents: events,
    cpuProductionOrder: production && { id: production.canonicalId, status: production.status, sourceVersion: production.sourceVersion, serviceDate: production.serviceDate, destinationOplocId: production.destinationOplocId, lines: lineSummary(production.lines) },
    logisticsFulfilmentRequirements: requirements.map(item => ({ id: item.canonicalId, status: item.status, sourceVersion: item.sourceVersion, destinationOplocId: item.destinationOplocId, serviceDate: item.serviceDate, lines: lineSummary(item.lines) })),
    reconciliation: order && production && { sourceVersionMatches: production.sourceVersion === order.version, statusMatches: (order.status === "cancelled") === (production.status === "cancelled"), quantitiesMatch: JSON.stringify(lineSummary(order.lines.map((line: any) => ({ canonicalItemId: line.productId, quantity: line.quantity }))).sort()) === JSON.stringify(lineSummary(production.lines).sort()) || order.status === "cancelled" },
  }, null, 2));
}

await (command === "census" ? census() : report());
