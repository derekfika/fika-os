import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { isDeepStrictEqual } from "node:util";
import type { Dish, DraftVersion, Menu, Publication, Section } from "./contract";
import { StudioProblem } from "./problem";
import { studioRuntime } from "./runtime";
import { menuSchema } from "./schema";

const root = "fikaHospitalityMenuStudioV1";
const pageSize = 50;
type Draft = Menu | Dish;
type DraftData<T extends Draft> = {
  item: T;
  actorId: string;
  baseVersion: number;
  source: "hospitality-menu-studio";
  restoredFromVersion?: number;
};
type StoredSection = Omit<Section, "weeks"> & { weeks: { dishIds: string[] }[] };
type StoredMenu = Omit<Menu, "sections"> & { sections: StoredSection[] };
type StoredDraft = Omit<DraftData<Draft>, "item"> & { item: StoredMenu | Dish };
type DraftCollection = "menus" | "dishes";
export type Page<T> = { items: T[]; nextCursor: string | null };

export class StudioStore {
  constructor(private db: Firestore, private now = () => new Date()) {}

  async list<T extends Draft>(kind: DraftCollection, cursor?: string): Promise<Page<T>> {
    const snapshot = await this.page(this.db.collection(`${root}_${kind}`), cursor);
    return {
      items: snapshot.docs.slice(0, pageSize).map(document => decodeDraft<T>(document.data() as StoredDraft).item),
      nextCursor: snapshot.docs.length > pageSize ? snapshot.docs[pageSize - 1].id : null,
    };
  }

  async listHistory(menuId: string, cursor?: string): Promise<Page<Publication>> {
    const history = this.db.collection(`${root}_menus`).doc(menuId).collection("publications");
    let query = history.orderBy("revision", "desc").limit(pageSize + 1);
    if (cursor) {
      const last = await history.doc(cursor).get();
      if (!last.exists) throw new StudioProblem(422, "INVALID_CURSOR", "This history page is unavailable.");
      query = query.startAfter(last);
    }
    const snapshot = await query.get();
    return {
      items: snapshot.docs.slice(0, pageSize).map(document => document.data() as Publication),
      nextCursor: snapshot.docs.length > pageSize ? snapshot.docs[pageSize - 1].id : null,
    };
  }

  async listVersions(kind: DraftCollection, id: string, cursor?: number): Promise<Page<DraftVersion>> {
    const versions = this.draftHead(kind, id).collection("revisions");
    let query = versions.orderBy("item.version", "desc").limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const items = snapshot.docs.slice(0, pageSize).map(document => {
      const { item, actorId, restoredFromVersion } = document.data() as StoredDraft;
      return {
        version: item.version, savedAt: item.updatedAt, actorId,
        ...(restoredFromVersion === undefined ? {} : { restoredFromVersion }),
      };
    });
    return { items, nextCursor: snapshot.docs.length > pageSize ? String(items.at(-1)?.version) : null };
  }

  async readMenuRevision(menuId: string, version: number): Promise<Menu> {
    const document = await this.draftHead("menus", menuId).collection("revisions").doc(String(version)).get();
    return archivedMenu(document.data() as StoredDraft | undefined, menuId, version);
  }

  async read<T extends Draft>(kind: DraftCollection, id: string): Promise<T> {
    const document = await this.draftHead(kind, id).get();
    if (!document.exists) throw new StudioProblem(404, "DRAFT_NOT_FOUND", "This draft could not be found.");
    return decodeDraft<T>(document.data() as StoredDraft).item;
  }

  async dishes(ids: string[]): Promise<Dish[]> {
    const dishes: Dish[] = [];
    const collection = this.db.collection(`${root}_dishes`);
    for (let offset = 0; offset < ids.length; offset += 100) {
      const documents = await this.db.getAll(...ids.slice(offset, offset + 100).map(id => collection.doc(id)));
      for (const document of documents) if (document.exists) dishes.push(decodeDraft<Dish>(document.data() as StoredDraft).item);
    }
    return dishes;
  }

  async save<T extends Draft>(kind: DraftCollection, actorId: string, draft: T): Promise<T> {
    const head = this.draftHead(kind, draft.id);
    return this.db.runTransaction(async transaction => {
      const previous = (await transaction.get(head)).data() as StoredDraft | undefined;
      const existing = previous && decodeDraft<T>(previous);
      const baseVersion = existing?.item.version ?? 0;
      const sameContent = existing && isDeepStrictEqual(content(existing.item), content(draft));
      if (draft.version !== baseVersion) {
        if (sameContent && existing.actorId === actorId && existing.baseVersion === draft.version && !existing.restoredFromVersion) return existing.item;
        throw conflict();
      }
      if (sameContent) return existing.item;

      return this.writeRevision(transaction, head, draft, actorId, baseVersion);
    });
  }

  async restoreMenuDraft(actorId: string, id: string, expectedVersion: number, sourceVersion: number) {
    if (sourceVersion >= expectedVersion) {
      throw new StudioProblem(422, "INVALID_RESTORE_SOURCE", "Select an earlier version to restore.");
    }
    const head = this.draftHead("menus", id);
    const revisions = head.collection("revisions");
    const restoredVersion = expectedVersion + 1;
    return this.db.runTransaction(async transaction => {
      const current = (await transaction.get(head)).data() as StoredDraft | undefined;
      if (!current) throw new StudioProblem(404, "DRAFT_NOT_FOUND", "This draft could not be found.");
      if (current.item.version !== expectedVersion) {
        if (current.item.version < restoredVersion) throw conflict();
        const receipt = current.item.version === restoredVersion ? current
          : (await transaction.get(revisions.doc(String(restoredVersion)))).data() as StoredDraft | undefined;
        if (receipt?.actorId === actorId && receipt.baseVersion === expectedVersion && receipt.restoredFromVersion === sourceVersion) {
          archivedMenu(receipt, id, restoredVersion);
          return { item: decodeDraft<Menu>(current).item, restoredVersion };
        }
        throw conflict();
      }

      const archived = (await transaction.get(revisions.doc(String(sourceVersion)))).data() as StoredDraft | undefined;
      const item = this.writeRevision(transaction, head, archivedMenu(archived, id, sourceVersion), actorId, expectedVersion, sourceVersion);
      return { item, restoredVersion };
    });
  }

  private writeRevision<T extends Draft>(
    transaction: Transaction, head: DocumentReference, draft: T, actorId: string, baseVersion: number, restoredFromVersion?: number,
  ): T {
    const item: T = { ...draft, version: baseVersion + 1, updatedAt: this.now().toISOString() };
    const evidence = encodeDraft({
      item, actorId, baseVersion, source: "hospitality-menu-studio",
      ...(restoredFromVersion === undefined ? {} : { restoredFromVersion }),
    });
    transaction.set(head, evidence);
    transaction.create(head.collection("revisions").doc(String(item.version)), evidence);
    return item;
  }

  private draftHead(kind: DraftCollection, id: string) { return this.db.collection(`${root}_${kind}`).doc(id); }

  private page(collection: FirebaseFirestore.CollectionReference, cursor?: string) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    return query.get();
  }
}

// Firestore accepts lists of maps, but no directly nested arrays.
function encodeDraft({ item, ...evidence }: DraftData<Draft>): StoredDraft {
  if (!("sections" in item)) return { ...evidence, item };
  const sections = item.sections.map(section => ({ ...section, weeks: section.weeks.map(dishIds => ({ dishIds })) }));
  return { ...evidence, item: { ...item, sections } };
}

function decodeDraft<T extends Draft>({ item, ...evidence }: StoredDraft): DraftData<T> {
  if (!("sections" in item)) return { ...evidence, item: item as T };
  const sections = item.sections.map(section => ({ ...section, weeks: section.weeks.map(week => week.dishIds) }));
  return { ...evidence, item: { ...item, sections } as T };
}

function content({ version: _version, updatedAt: _updatedAt, ...draft }: Draft) { return draft; }

function conflict() {
  return new StudioProblem(409, "DRAFT_CONFLICT", "Someone saved a newer version. Your edits are still available locally.");
}

function archivedMenu(value: StoredDraft | undefined, menuId: string, version: number): Menu {
  if (!value) throw new StudioProblem(404, "DRAFT_REVISION_MISSING", "The requested draft revision could not be found.");
  const parsed = menuSchema.safeParse(decodeDraft<Menu>(value).item);
  if (!parsed.success || parsed.data.id !== menuId || parsed.data.version !== version) {
    throw new StudioProblem(503, "DRAFT_REVISION_INTEGRITY", "The draft revision could not be verified.");
  }
  return parsed.data;
}

export function studioStore() {
  const runtime = studioRuntime();
  if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  const name = `hospitality-menu-studio-${runtime.projectId}`;
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId: runtime.projectId }, name);
  return new StudioStore(getFirestore(app));
}
