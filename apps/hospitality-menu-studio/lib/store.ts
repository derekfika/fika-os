import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { isDeepStrictEqual } from "node:util";
import type { Dish, Menu, Publication, Section } from "./contract";
import { StudioProblem } from "./problem";
import { studioRuntime } from "./runtime";

const root = "fikaHospitalityMenuStudioV1";
const pageSize = 50;
type Draft = Menu | Dish;
type DraftData<T extends Draft> = { item: T; actorId: string; baseVersion: number; source: "hospitality-menu-studio" };
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

  async read<T extends Draft>(kind: DraftCollection, id: string): Promise<T> {
    const document = await this.db.collection(`${root}_${kind}`).doc(id).get();
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
    const head = this.db.collection(`${root}_${kind}`).doc(draft.id);
    return this.db.runTransaction(async transaction => {
      const previous = (await transaction.get(head)).data() as StoredDraft | undefined;
      const existing = previous && decodeDraft<T>(previous);
      const baseVersion = existing?.item.version ?? 0;
      const sameContent = existing && isDeepStrictEqual(content(existing.item), content(draft));
      if (draft.version !== baseVersion) {
        if (sameContent && existing.actorId === actorId && existing.baseVersion === draft.version) return existing.item;
        throw new StudioProblem(409, "DRAFT_CONFLICT", "Someone saved a newer version. Your edits are still available locally.");
      }
      if (sameContent) return existing.item;

      const item: T = { ...draft, version: baseVersion + 1, updatedAt: this.now().toISOString() };
      const evidence: DraftData<T> = { item, actorId, baseVersion, source: "hospitality-menu-studio" };
      transaction.set(head, encodeDraft(evidence));
      transaction.create(head.collection("revisions").doc(String(item.version)), encodeDraft(evidence));
      return item;
    });
  }

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

export function studioStore() {
  const runtime = studioRuntime();
  if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  const name = `hospitality-menu-studio-${runtime.projectId}`;
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId: runtime.projectId }, name);
  return new StudioStore(getFirestore(app));
}
