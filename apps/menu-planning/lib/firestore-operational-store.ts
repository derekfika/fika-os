import { Firestore, type DocumentData, type DocumentSnapshot, type QuerySnapshot, type Transaction } from "@google-cloud/firestore";
import { createHash } from "node:crypto";
import { claimEvent, eventIsDue, type DurableDomainEvent } from "./fika-contracts";
import type { CompiledPublishedWeekSnapshot, MenuPublication } from "./menu-publication";
import type { RollingDay, RollingEntry, RollingSnapshot, RollingWeek } from "./rolling-menu-types";
import { recordMenuPlanningReadBudget } from "./read-budget";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

function recordFirestore(operation: string, documents: number) { recordDataAccess({ app: "menu-planning", operation, source: "FIRESTORE", documents }); }

export const MENU_PLANNING_COLLECTIONS = {
  weeks: "fikaMenuPlanningWeeks", publications: "fikaMenuPlanningPublications", events: "fikaMenuPlanningEvents", outbox: "fikaMenuPlanningOutbox", archive: "fikaMenuPlanningArchiveMetadata", catalogue: "fikaMenuPlanningCatalogue", publishedSnapshots: "fikaMenuPlanningPublishedSnapshots",
} as const;
export type HostedTransactionState = { rolling: { version?: number; weeks: RollingWeek[]; days: RollingDay[]; entries: RollingEntry[] }; publications: { version: number; publications: MenuPublication[]; events: DurableDomainEvent[] } };
export type MenuPlanningTransactionScope = { weekId?: string; sourceWeekId?: string; includeEvents?: boolean };
export class ExpectedVersionConflict extends Error { status = 409 as const; }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const omit = (value: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const omitPublicationDayMetadata = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([name]) => !["publicationId", "status", "withdrawal", "driveArchive"].includes(name)));
const storedPublicationDay = (day: Record<string, unknown>, publicationId: string) => ({ ...day, publicationId });
export function assertExpectedVersion(actual: number | undefined, expected: number, aggregateId: string) { if (actual !== expected) throw new ExpectedVersionConflict(`${aggregateId} changed from version ${expected} to ${String(actual)}; refresh before saving.`); }

/** Async server-only adapter. It never exposes a Firestore client to browser code. */
export class MenuPlanningFirestoreRepository {
  readonly db: Firestore;
  constructor(db = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT })) { this.db = db; }
  async readRollingState() { return this.db.runTransaction(transaction => this.readRolling(transaction)); }
  async listWeekSummaries() { const snapshot = await this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).limit(100).get(); recordFirestore("week.summaries", snapshot.size); recordMenuPlanningReadBudget({ operation: "week_summaries", reads: { weeks: snapshot.size, days: 0, entries: 0, scoped: 1 } }); return snapshot.docs.map(doc => doc.data() as RollingWeek); }
  async getWeekSnapshot(weekId: string) {
    const weekRef = this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(weekId);
    const weekDoc = await weekRef.get();
    recordFirestore("week.by-id", weekDoc.exists ? 1 : 0);
    if (!weekDoc.exists) return undefined;
    const week = weekDoc.data() as RollingWeek;
    const daySnapshot = await weekRef.collection("days").get();
    recordFirestore("week.days", daySnapshot.size);
    const days = daySnapshot.docs.map(doc => doc.data() as RollingDay);
    const entrySnapshots = await Promise.all(days.map(day => weekRef.collection("days").doc(day.id).collection("entries").get()));
    const entries = entrySnapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data() as RollingEntry));
    recordFirestore("week.entries", entries.length);
    recordMenuPlanningReadBudget({ operation: "week_snapshot", reads: { weeks: 1, days: daySnapshot.size, entries: entries.length, scoped: 1 } });
    return { week, days, entries };
  }
  async getPublicationById(publicationId: string) {
    const publication = await this.db.collection(MENU_PLANNING_COLLECTIONS.publications).doc(publicationId).get();
    recordFirestore("publication.by-id", publication.exists ? 1 : 0);
    if (!publication.exists) return undefined;
    const days = await publication.ref.collection("days").get();
    recordFirestore("publication.days", days.size);
    recordMenuPlanningReadBudget({ operation: "publication_by_id", reads: { publications: 1, publicationDays: days.size, events: 0, scoped: 1 } });
    return { ...publication.data(), days: days.docs.map(day => day.data()) } as MenuPublication;
  }
  async listPublicationState(limit = 16) {
    const snapshot = await this.db.collection(MENU_PLANNING_COLLECTIONS.publications).orderBy("weekCommencing", "desc").limit(Math.min(Math.max(limit, 1), 100)).get();
    recordFirestore("publication.list", snapshot.size);
    const publications: MenuPublication[] = [];
    for (const doc of snapshot.docs) {
      const days = await doc.ref.collection("days").get();
      publications.push({ ...doc.data(), days: days.docs.map(day => day.data()) } as MenuPublication);
    }
    recordMenuPlanningReadBudget({ operation: "publication_list", reads: { publications: snapshot.size, publicationDays: publications.reduce((total, publication) => total + publication.days.length, 0), events: 0, scoped: 1 } });
    return { version: 2, publications, events: [] as DurableDomainEvent[] };
  }
  async readPublicationStateForWeek(weekId: string) {
    const snapshot = await this.db.collection(MENU_PLANNING_COLLECTIONS.publications).where("sourceWeekId", "==", weekId).get();
    recordFirestore("publication.for-week", snapshot.size);
    const publications: MenuPublication[] = [];
    for (const doc of snapshot.docs) { const value = doc.data(); const days = await doc.ref.collection("days").get(); publications.push({ ...value, days: days.docs.map(day => day.data()) } as unknown as MenuPublication); }
    return { version: 2, publications, events: [] as DurableDomainEvent[] };
  }
  async readPublicationStateForDateRange(fromWeek: string, toWeekExclusive: string) {
    const snapshot = await this.db.collection(MENU_PLANNING_COLLECTIONS.publications)
      .where("weekCommencing", ">=", fromWeek)
      .where("weekCommencing", "<", toWeekExclusive)
      .orderBy("weekCommencing", "asc")
      .limit(16)
      .get();
    recordFirestore("publication.date-range", snapshot.size);
    const publications: MenuPublication[] = [];
    for (const doc of snapshot.docs) {
      const value = doc.data();
      const days = await doc.ref.collection("days").get();
      publications.push({ ...value, days: days.docs.map(day => day.data()) } as unknown as MenuPublication);
    }
    recordMenuPlanningReadBudget({ operation: "publication_date_range", reads: { publications: snapshot.size, publicationDays: publications.reduce((total, publication) => total + publication.days.length, 0), events: 0, scoped: 1 } });
    return { version: 2, publications, events: [] as DurableDomainEvent[] };
  }
  async getPublishedSnapshot(publicationId: string, version?: number) {
    const publication = await this.db.collection(MENU_PLANNING_COLLECTIONS.publications).doc(publicationId).get();
    if (!publication.exists) return undefined;
    const id = version ? `${publicationId}:snapshot:v${version}` : publication.data()?.compiledSnapshotId as string | undefined;
    if (!id) return undefined;
    const snapshot = await this.db.collection(MENU_PLANNING_COLLECTIONS.publishedSnapshots).doc(id).get();
    return snapshot.exists ? snapshot.data() as CompiledPublishedWeekSnapshot : undefined;
  }
  async readPublicationState() { return this.db.runTransaction(transaction => this.readPublications(transaction)); }
  async updateEvent(eventId: string, mutator: (event: DurableDomainEvent) => DurableDomainEvent | undefined) {
    return this.db.runTransaction(async transaction => {
      const ref = this.db.collection(MENU_PLANNING_COLLECTIONS.events).doc(eventId);
      const document = await transaction.get(ref);
      if (!document.exists) return undefined;
      const next = mutator(document.data() as DurableDomainEvent);
      if (next) {
        transaction.set(ref, next);
        transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.outbox).doc(eventId), next);
      }
      return next;
    });
  }
  async claimNextEvent(claimId: string, at = new Date()) {
    return this.db.runTransaction(async transaction => {
      const events = await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.events).where("delivery.status", "in", ["pending", "failed"]).limit(100));
      recordFirestore("events.pending", events.size);
      const candidates = events.docs.map(document => document.data() as DurableDomainEvent).filter(event => eventIsDue(event, at)).sort((a, b) => a.sourceAggregateId.localeCompare(b.sourceAggregateId) || a.sourceVersion - b.sourceVersion || a.eventId.localeCompare(b.eventId));
      for (const candidate of candidates) {
        const aggregate = await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.events).where("sourceAggregateId", "==", candidate.sourceAggregateId));
        const blocked = aggregate.docs.some(document => { const previous = document.data() as DurableDomainEvent; return previous.sourceVersion < candidate.sourceVersion && previous.delivery.status !== "delivered"; });
        if (blocked) continue;
        const next = claimEvent(candidate, claimId, at.toISOString());
        const ref = this.db.collection(MENU_PLANNING_COLLECTIONS.events).doc(candidate.eventId);
        transaction.set(ref, next);
        transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.outbox).doc(candidate.eventId), next);
        return next;
      }
      return undefined;
    });
  }
  async runTransaction<T>(mutator: (state: HostedTransactionState) => T | Promise<T>, expected?: { weekId?: string; weekVersion?: number }, scope: MenuPlanningTransactionScope = {}) {
    return this.db.runTransaction(async transaction => {
      const before = { rolling: await this.readRolling(transaction, scope.weekId), publications: await this.readPublications(transaction, scope.sourceWeekId, scope.includeEvents !== false) };
      recordMenuPlanningReadBudget({ operation: "transaction", reads: { weeks: before.rolling.weeks.length, days: before.rolling.days.length, entries: before.rolling.entries.length, publications: before.publications.publications.length, publicationDays: before.publications.publications.reduce((total, publication) => total + publication.days.length, 0), events: before.publications.events.length, scoped: scope.weekId || scope.sourceWeekId ? 1 : 0 } });
      if (expected?.weekId && expected.weekVersion !== undefined) assertExpectedVersion(before.rolling.weeks.find((week: RollingWeek) => week.id === expected.weekId)?.version, expected.weekVersion, expected.weekId);
      const state = structuredClone(before) as HostedTransactionState;
      const result = await mutator(state);
      await this.writeRollingDiff(transaction, before.rolling, state.rolling);
      await this.writePublicationDiff(transaction, before.publications, state.publications);
      return result;
    });
  }
  private async readRolling(transaction: Transaction, weekId?: string) {
    const weekSnap = weekId ? await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(weekId)) : await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks));
    recordFirestore("week.transaction-read", weekId ? ((weekSnap as DocumentSnapshot).exists ? 1 : 0) : (weekSnap as QuerySnapshot).size);
    const weeks: RollingWeek[] = weekId ? ((weekSnap as DocumentSnapshot).exists ? [(weekSnap as DocumentSnapshot).data() as RollingWeek] : []) : (weekSnap as QuerySnapshot).docs.map(doc => doc.data() as RollingWeek);
    const dayRefs = weeks.flatMap(week => (week.dayIds || []).map(id => this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(week.id).collection("days").doc(id)));
    const daySnap = dayRefs.length ? await transaction.getAll(...dayRefs) : [];
    const days = daySnap.filter(doc => doc.exists).map(doc => doc.data() as RollingDay);
    const entryRefs = days.flatMap(day => { const weekId = day.id.split(":day:")[0]; return (day.entryIds || []).map(id => this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(weekId).collection("days").doc(day.id).collection("entries").doc(id)); });
    const entrySnap = entryRefs.length ? await transaction.getAll(...entryRefs) : [];
    return { weeks, days, entries: entrySnap.filter(doc => doc.exists).map(doc => doc.data() as RollingEntry) };
  }
  private async readPublications(transaction: Transaction, sourceWeekId?: string, includeEvents = true) {
    const root = sourceWeekId ? await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.publications).where("sourceWeekId", "==", sourceWeekId)) : await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.publications));
    recordFirestore("publication.transaction-read", root.size);
    const publications: MenuPublication[] = [];
    const days: DocumentData[] = [];
    for (const doc of root.docs) { const value = doc.data(); publications.push({ ...value, days: [] } as unknown as MenuPublication); const daySnap = await transaction.get(doc.ref.collection("days")); days.push(...daySnap.docs.map(day => day.data())); }
    for (const publication of publications) publication.days = days.filter(day => day.publicationId === publication.publicationId) as MenuPublication["days"];
    const eventSnap = includeEvents ? await transaction.get(this.db.collection(MENU_PLANNING_COLLECTIONS.events)) : { docs: [] as Array<{ data(): DocumentData }>, size: 0 };
    recordFirestore("events.transaction-read", eventSnap.size || eventSnap.docs.length);
    return { version: 2, publications, events: eventSnap.docs.map(doc => doc.data() as DurableDomainEvent) };
  }
  private async writeRollingDiff(transaction: Transaction, before: HostedTransactionState["rolling"], after: HostedTransactionState["rolling"]) {
    const beforeWeeks = new Map(before.weeks.map(value => [value.id, value])); const afterWeeks = new Map(after.weeks.map(value => [value.id, value]));
    const beforeDays = new Map(before.days.map(value => [value.id, value])); const afterDays = new Map(after.days.map(value => [value.id, value]));
    const beforeEntries = new Map(before.entries.map(value => [value.id, value])); const afterEntries = new Map(after.entries.map(value => [value.id, value]));
    for (const [id, value] of afterWeeks) if (!beforeWeeks.has(id) || digest(beforeWeeks.get(id)!) !== digest(value)) transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(id), value);
    for (const [id, value] of afterDays) { const weekId = id.split(":day:")[0]; if (!beforeDays.has(id) || digest(beforeDays.get(id)!) !== digest(value)) transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(weekId).collection("days").doc(id), value); }
    for (const [id, value] of afterEntries) { const day = after.days.find(candidate => candidate.entryIds?.includes(id)); if (!day) throw new Error(`Entry ${id} is not attached to a day.`); const weekId = day.id.split(":day:")[0]; if (!beforeEntries.has(id) || digest(beforeEntries.get(id)!) !== digest(value)) transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(weekId).collection("days").doc(day.id).collection("entries").doc(id), value); }
    for (const id of [...beforeEntries.keys()].filter(id => !afterEntries.has(id))) { const day = before.days.find(candidate => candidate.entryIds?.includes(id)); if (day) transaction.delete(this.db.collection(MENU_PLANNING_COLLECTIONS.weeks).doc(day.id.split(":day:")[0]).collection("days").doc(day.id).collection("entries").doc(id)); }
  }
  private async writePublicationDiff(transaction: Transaction, before: HostedTransactionState["publications"], after: HostedTransactionState["publications"]) {
    const beforePubs = new Map(before.publications.map(value => [value.publicationId, value]));
    for (const publication of after.publications) {
      const previous = beforePubs.get(publication.publicationId);
      const root = this.db.collection(MENU_PLANNING_COLLECTIONS.publications).doc(publication.publicationId);
      if (!previous || digest(omit(previous as unknown as Record<string, unknown>, "days")) !== digest(omit(publication as unknown as Record<string, unknown>, "days"))) transaction.set(root, omit(publication as unknown as Record<string, unknown>, "days"));
      if (previous) for (const oldDay of previous.days) if (!publication.days.some(day => day.publicationDayId === oldDay.publicationDayId)) throw new ExpectedVersionConflict(`Publication day ${oldDay.publicationDayId} cannot be deleted.`);
      for (const day of publication.days) {
        const old = previous?.days.find(value => value.publicationDayId === day.publicationDayId);
        if (old && digest(omitPublicationDayMetadata(old as unknown as Record<string, unknown>)) !== digest(omitPublicationDayMetadata(day as unknown as Record<string, unknown>))) throw new ExpectedVersionConflict(`Immutable publication day ${day.publicationDayId} differs from stored state.`);
        const next = storedPublicationDay(day as unknown as Record<string, unknown>, publication.publicationId);
        if (!old || digest(storedPublicationDay(old as unknown as Record<string, unknown>, publication.publicationId)) !== digest(next)) transaction.set(root.collection("days").doc(day.publicationDayId), next);
      }
    }
    const snapshots = (after as unknown as { snapshots?: Record<string, CompiledPublishedWeekSnapshot> }).snapshots || {};
    for (const [snapshotId, snapshot] of Object.entries(snapshots)) transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.publishedSnapshots).doc(snapshotId), snapshot);
    const beforeEvents = new Map(before.events.map(value => [value.eventId, value]));
    for (const event of after.events) { const old = beforeEvents.get(event.eventId); if (old && digest(old) !== digest(event) && old.delivery.status === "delivered" && event.delivery.status !== "delivered") throw new ExpectedVersionConflict(`Delivered event ${event.eventId} cannot be rewound.`); if (!old || digest(old) !== digest(event)) { transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.events).doc(event.eventId), event); transaction.set(this.db.collection(MENU_PLANNING_COLLECTIONS.outbox).doc(event.eventId), event); } }
  }
}
