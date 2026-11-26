"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  productMenuConfiguration, productMenuDraft,
  type ProductMenuConfiguration, type ProductMenuDraft,
} from "../../shared/hospitality-menu-studio-product-content";

type Status = "saved" | "unsaved" | "saving" | "conflict" | "error";
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SaveAccess = {
  canManage: boolean;
  onSave: (snapshot: ProductMenuDraft) => Promise<ProductMenuDraft>;
  onLoadLatest?: () => Promise<ProductMenuDraft>;
};
type Options = SaveAccess & { draft: ProductMenuDraft; recoveryScope: string };

const recoverySchema = z.strictObject({
  schemaVersion: z.literal(1), retainedAt: z.iso.datetime(),
  draft: productMenuDraft, pending: productMenuDraft.optional(), conflicted: z.boolean(),
}).refine(copy => !copy.pending || (copy.pending.itemId === copy.draft.itemId && copy.pending.version === copy.draft.version));

type Recovery = z.infer<typeof recoverySchema>;
type EditorState = {
  configuration: ProductMenuConfiguration;
  status: Status;
  dirty: boolean;
  error: string;
  retainedAt: string | null;
  recovery: Recovery | null;
};
const maximumRecoveryCharacters = 1_010_000;
const saveDelayMs = 900;
const staleMessage = "This draft changed elsewhere. Your edits are still available here. Open the latest draft to continue.";
const storageMessage = "This device could not retain the edits. Keep the editor open until the draft is saved.";

export function productMenuRecoveryKey(scope: string, itemId: string) {
  if (!/^[a-f0-9]{64}$/.test(scope)) return undefined;
  return `fika-studio-product-draft:v1:${scope}:${encodeURIComponent(itemId)}`;
}

function sameConfiguration(a: ProductMenuConfiguration, b: ProductMenuConfiguration) {
  if (a === b) return true;
  const left = productMenuConfiguration.safeParse(a);
  const right = productMenuConfiguration.safeParse(b);
  return left.success && right.success && JSON.stringify(left.data) === JSON.stringify(right.data);
}

function initial(draft: ProductMenuDraft): EditorState {
  return { configuration: draft.configuration, dirty: false, status: "saved", error: "", retainedAt: null, recovery: null };
}

/** One editor owns the working copy. The browser keeps edits in the current tab and authority scope. */
export class ProductMenuDraftEditor {
  private readonly key: string | undefined;
  private readonly listeners = new Set<() => void>();
  private state: EditorState;
  private working: ProductMenuDraft;
  private pending?: ProductMenuDraft;
  private timer?: ReturnType<typeof setTimeout>;
  private saveFlight?: Promise<boolean>;
  private loadFlight?: Promise<boolean>;
  private storage?: StorageAccess;
  private storedValue: string | null = null;
  private connected = false;
  private restored = false;

  constructor(private base: ProductMenuDraft, scope: string, private readonly access: () => SaveAccess) {
    this.key = productMenuRecoveryKey(scope, base.itemId);
    this.working = base;
    this.state = initial(base);
  }

  snapshot = () => this.state;

  subscribe = (listen: () => void) => {
    this.listeners.add(listen);
    return () => { this.listeners.delete(listen); };
  };

  private update(partial: Partial<EditorState>) {
    this.state = { ...this.state, ...partial };
    for (const listen of this.listeners) listen();
  }

  connect(storage?: StorageAccess) {
    this.connected = true;
    this.storage = storage;
    if (!this.restored && this.key && storage) {
      this.restored = true;
      try {
        const raw = storage.getItem(this.key);
        if (raw && raw.length <= maximumRecoveryCharacters) {
          const copy = recoverySchema.safeParse(JSON.parse(raw));
          if (copy.success && copy.data.draft.itemId === this.base.itemId) {
            this.storedValue = raw;
            if (this.base.version >= copy.data.draft.version && sameConfiguration(this.base.configuration, copy.data.draft.configuration)) {
              this.clearStored();
            } else this.update({ recovery: copy.data });
          }
        }
      } catch {
        // An unreadable browser copy cannot replace the authoritative draft.
      }
    }
    this.scheduleSave();
    return () => {
      this.connected = false;
      this.cancelTimer();
    };
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  scheduleSave = () => {
    this.cancelTimer();
    if (!this.connected || !this.access().canManage || this.saveFlight || this.loadFlight || this.state.status !== "unsaved") return;
    this.timer = setTimeout(() => { void this.save(); }, saveDelayMs);
  };

  private clearStored() {
    try {
      if (this.key && this.storage && this.storedValue !== null && this.storage.getItem(this.key) === this.storedValue) {
        this.storage.removeItem(this.key);
      }
    } catch {
      // Do not infer that a storage action succeeded.
    }
    this.storedValue = null;
  }

  private retain(): Recovery | undefined {
    const candidate = recoverySchema.safeParse({
      schemaVersion: 1, retainedAt: new Date().toISOString(), draft: this.working,
      ...(this.pending && { pending: this.pending }), conflicted: this.state.status === "conflict",
    });
    if (!candidate.success) { this.update({ retainedAt: null }); return; }
    const copy = candidate.data;
    const raw = JSON.stringify(copy);
    try {
      if (!this.key || !this.storage || raw.length > maximumRecoveryCharacters) throw new Error(storageMessage);
      this.storage.setItem(this.key, raw);
      this.storedValue = raw;
      this.update({ retainedAt: copy.retainedAt });
    } catch {
      this.update({ retainedAt: null, error: this.state.error || storageMessage });
    }
    return copy;
  }

  synchronize(draft: ProductMenuDraft) {
    if (draft.itemId !== this.base.itemId || draft.version <= this.base.version || this.saveFlight || this.loadFlight) return;
    this.base = draft;
    this.pending = undefined;
    if (this.state.dirty && !sameConfiguration(this.working.configuration, draft.configuration)) {
      this.update({ status: "conflict", error: staleMessage });
      this.retain();
    } else {
      if (this.state.dirty) this.clearStored();
      this.working = draft;
      this.update({ configuration: draft.configuration, status: "saved", error: "", dirty: false, retainedAt: null });
    }
  }

  change = (update: (current: ProductMenuConfiguration) => ProductMenuConfiguration) => {
    if (!this.connected || !this.access().canManage || this.loadFlight) return;
    if (this.state.recovery) {
      this.update({ error: "Resume or discard the retained draft before editing." });
      return;
    }
    const configuration = update(this.working.configuration);
    if (sameConfiguration(configuration, this.working.configuration)) return;
    this.working = { ...this.working, configuration };
    const dirty = Boolean(this.saveFlight || this.pending || !sameConfiguration(configuration, this.base.configuration));
    const status = this.state.status === "conflict" ? "conflict" : this.saveFlight ? "saving"
      : !dirty ? "saved" : this.state.status === "error" ? "error" : "unsaved";
    this.update({ configuration, dirty, status, error: status === "conflict" || status === "error" ? this.state.error : "" });
    if (dirty) this.retain();
    else {
      this.clearStored();
      this.update({ retainedAt: null });
    }
    this.scheduleSave();
  };

  save = (): Promise<boolean> => {
    if (this.saveFlight) return this.saveFlight;
    if (!this.connected || !this.access().canManage || this.loadFlight || this.state.recovery || this.state.status === "conflict") return Promise.resolve(false);
    if (!this.state.dirty) return Promise.resolve(true);
    this.cancelTimer();
    const candidate = productMenuDraft.safeParse(this.pending ?? this.working);
    if (!candidate.success) {
      this.update({ status: "error", error: candidate.error.issues[0]?.message ?? "Check the draft before saving." });
      return Promise.resolve(false);
    }
    const snapshot = candidate.data;
    this.pending = snapshot;
    this.update({ status: "saving", error: "" });
    this.retain();
    const flight = this.saveSnapshot(snapshot).finally(() => {
      this.saveFlight = undefined;
      this.scheduleSave();
    });
    this.saveFlight = flight;
    return flight;
  };

  private async saveSnapshot(snapshot: ProductMenuDraft) {
    try {
      const saved = productMenuDraft.parse(await this.access().onSave(snapshot));
      if (saved.itemId !== snapshot.itemId || saved.version < snapshot.version || saved.version > snapshot.version + 1 ||
          !sameConfiguration(saved.configuration, snapshot.configuration)) throw new Error("Studio could not verify the save acknowledgement. Retry this save.");
      if (!this.connected) return false;
      this.pending = undefined;
      this.base = saved;
      const dirty = !sameConfiguration(this.working.configuration, saved.configuration);
      this.working = dirty ? { ...saved, configuration: this.working.configuration } : saved;
      this.update({ configuration: this.working.configuration, dirty, status: dirty ? "unsaved" : "saved", error: "" });
      if (dirty) this.retain();
      else {
        this.clearStored();
        this.update({ retainedAt: null });
      }
      return !dirty;
    } catch (failure) {
      if (!this.connected) return false;
      const status = (failure as { status?: number })?.status;
      const message = failure instanceof Error ? failure.message : "";
      if (status && status >= 400 && status < 500) this.pending = undefined;
      this.update({ status: status === 409 ? "conflict" : "error",
        error: status === 409 ? staleMessage : message || "The menu save was not confirmed. Try again." });
      this.retain();
      return false;
    }
  }

  discard = () => {
    if (this.saveFlight || this.loadFlight) return false;
    this.cancelTimer();
    this.pending = undefined;
    this.working = this.base;
    this.clearStored();
    this.update(initial(this.base));
    return true;
  };

  resumeRecovery = () => {
    const copy = this.state.recovery;
    if (!copy || !this.connected || !this.access().canManage || this.saveFlight || this.loadFlight) return false;
    const conflict = copy.conflicted || copy.draft.version !== this.base.version;
    this.working = copy.draft;
    this.pending = conflict ? undefined : copy.pending;
    this.update({ recovery: null, configuration: copy.draft.configuration, retainedAt: copy.retainedAt,
      dirty: true, status: conflict ? "conflict" : "unsaved", error: conflict ? staleMessage : "" });
    this.scheduleSave();
    return true;
  };

  discardRecovery = () => {
    if (!this.state.recovery || this.state.dirty || this.loadFlight) return false;
    return this.discard();
  };

  openLatest = (): Promise<boolean> => {
    if (this.loadFlight) return this.loadFlight;
    const load = this.access().onLoadLatest;
    if (!load || !this.connected || this.saveFlight) return Promise.resolve(false);
    this.cancelTimer();
    const flight = Promise.resolve().then(async () => {
      const latest = productMenuDraft.parse(await load());
      if (!this.connected) return false;
      if (latest.itemId !== this.base.itemId || latest.version < this.base.version) throw new Error("Studio could not verify the latest draft.");
      const copy = this.state.dirty && !sameConfiguration(this.working.configuration, latest.configuration)
        ? this.retain() : this.state.recovery;
      this.pending = undefined;
      this.base = latest;
      this.working = latest;
      if (!copy) this.clearStored();
      this.update({ ...initial(latest), recovery: copy ?? null });
      return true;
    }).catch(failure => {
      if (this.connected) this.update({ error: failure instanceof Error ? failure.message : "The latest draft could not be loaded." });
      return false;
    }).finally(() => { this.loadFlight = undefined; this.scheduleSave(); });
    this.loadFlight = flight;
    return flight;
  };
}

export function useProductMenuEditorDraft(options: Options) {
  const { draft, canManage, recoveryScope } = options;
  const live = useRef(options);
  live.current = options;
  const editor = useMemo(() => new ProductMenuDraftEditor(draft, recoveryScope, () => {
    const current = live.current;
    return { ...current, canManage: current.canManage && current.recoveryScope === recoveryScope && current.draft.itemId === draft.itemId };
  }), [draft.itemId, recoveryScope]);
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  useEffect(() => {
    let storage: StorageAccess | undefined;
    try { storage = window.sessionStorage; } catch { /* The server save is independent of browser storage. */ }
    return editor.connect(storage);
  }, [editor]);
  useEffect(() => editor.synchronize(draft), [editor, draft]);
  useEffect(() => { if (canManage) editor.scheduleSave(); }, [canManage, editor]);
  return { ...state, change: editor.change, save: editor.save, discard: editor.discard,
    resumeRecovery: editor.resumeRecovery, discardRecovery: editor.discardRecovery, openLatest: editor.openLatest };
}
