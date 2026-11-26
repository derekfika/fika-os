"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { browserCatalogueDeps, loadHospitalityCatalogue, type CatalogueManifest } from "@fika/server-shared/hospitality-catalogue-client";
import type { ProductMenuDraft, ProductMenuListing } from "../../shared/hospitality-menu-studio-product-content";
import type { Dish } from "../lib/contract";
import { productMenuDishBatchSize, productMenuDishKey, type ProductMenuDish } from "../lib/product-menu-dishes";
import { applyCatalogueReceipt, isCataloguePayload } from "./catalogue-state";
import type { CatalogueCommandResult, CataloguePayload } from "./catalogue-wire";
import { indexPublicCatalogue } from "./studio-catalogue-index";
import { StudioReadResource, type ReadState } from "./studio-read-resource";

type CursorPage<T> = { items: T[]; nextCursor: string | null };
type MenuIndexPage = CursorPage<ProductMenuListing> & { catalogueManifest?: CatalogueManifest };
const maxAge = 5 * 60_000;
const maxPackageBytes = 8 * 1024 * 1024;
const maxDecodedBytes = 32 * 1024 * 1024;
const publicPath = "/api/catalogue/public-package";

function remember<T>(items: T[], item: T, id: (value: T) => string, version: (value: T) => number) {
  const current = items.find(value => id(value) === id(item));
  if (current && version(current) > version(item)) return items;
  return [item, ...items.filter(value => id(value) !== id(item))];
}

export class StudioReads {
  readonly admission = new StudioReadResource<string>();
  readonly catalogue = new StudioReadResource<ReturnType<typeof indexPublicCatalogue>>();
  readonly admin = new StudioReadResource<CataloguePayload>();
  readonly summaries = new StudioReadResource<ProductMenuListing[]>();
  readonly dishes = new StudioReadResource<CursorPage<Dish>>();
  private readonly drafts = new Map<string, StudioReadResource<ProductMenuDraft | null>>();
  private readonly revisions = new Map<string, ProductMenuDish>();
  private readonly revisionRequests = new Map<string, Promise<void>>();
  private readonly assigned = new Map<string, Dish>();
  private readonly assignedCheckedAt = new Map<string, number>();
  private readonly assignedRequests = new Map<string, Promise<void>>();
  private readonly controller = new AbortController();
  private publicQueue = Promise.resolve<unknown>(undefined);
  private lastPublic?: ReturnType<typeof indexPublicCatalogue>;
  private stalePublicHash?: string;
  private adminVersion?: string;
  private adminLastFullRead = 0;
  private adminViews = 0;
  private localCatalogueChange = false;
  private mutations = new Map<string, Dish>();
  private notifyCatalogueChange?: () => void;

  constructor(private readonly scope: string, private readonly request: typeof fetch = fetch,
    private readonly catalogueDeps = browserCatalogueDeps) {}

  draftRecoveryScope() {
    return this.scope;
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.controller.signal.aborted) throw new Error("Reopen Studio to verify your session.");
    const headers = new Headers(init?.headers);
    headers.set("x-fika-studio-scope", this.scope);
    const request = this.request;
    const response = await request(input, {
      ...init, headers, credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: init?.signal ? AbortSignal.any([init.signal, this.controller.signal]) : this.controller.signal,
    });
    const denial = response.status === 403 ? await response.clone().json().catch(() => null) : null;
    const code = denial?.code ?? denial?.error?.code;
    if (code === "CATALOGUE_ACCESS_DENIED") this.admin.invalidate(new Error("Your catalogue access changed. Refresh to verify access."));
    if (response.status === 401 || code === "STUDIO_SCOPE_CHANGED" || code === "STUDIO_ACCESS_DENIED") {
      this.controller.abort();
      this.admin.invalidate();
      this.catalogue.invalidate();
      this.summaries.invalidate();
      this.dishes.invalidate();
      this.clearDrafts();
      this.assigned.clear();
      this.assignedCheckedAt.clear();
      this.revisions.clear();
      this.mutations.clear();
      this.lastPublic = undefined;
      this.dishPageBeforeRead = undefined;
      this.admission.set("Your Studio session or access has changed. Reopen Studio to continue.");
    }
    return response;
  };

  async json<T>(url: string): Promise<T> {
    const response = await this.fetch(url);
    const body = await response.json();
    if (!response.ok) {
      const message = typeof body.error === "string" ? body.error : body.error?.message;
      throw new Error(message || "This information is unavailable. Try again.");
    }
    return body as T;
  }

  publicIdentity() {
    const state = this.catalogue.snapshot();
    return state.value?.hash ?? (state.status === "loading" ? this.lastPublic?.hash : undefined);
  }

  loadPublic = (force = false, firstPage?: Promise<MenuIndexPage>) => this.catalogue.load(() => {
    // Keep IndexedDB writes ordered when a catalogue invalidation replaces an in-flight check.
    const work = this.publicQueue.catch(() => undefined).then(async () => {
      const browser = this.catalogueDeps(publicPath);
      let currentManifest: CatalogueManifest | undefined;
      const result = await loadHospitalityCatalogue({
        ...browser,
        fetchManifest: async () => {
          const manifest = (await firstPage?.catch(() => undefined))?.catalogueManifest ?? await this.json<CatalogueManifest>(publicPath);
          if (manifest?.dataset !== "hospitality-booking/catalogue") throw new Error("The public catalogue is unavailable.");
          if (!Number.isSafeInteger(manifest.compressedSize) || manifest.compressedSize > maxPackageBytes ||
              !Number.isSafeInteger(manifest.uncompressedSize) || manifest.uncompressedSize <= 0 || manifest.uncompressedSize > maxDecodedBytes) {
            throw new Error("The current catalogue package is too large or malformed.");
          }
          currentManifest = manifest;
          return manifest;
        },
        fetchPackageBytes: async hash => {
          const response = await this.fetch(publicPath + "/" + hash);
          if (!response.ok) throw new Error("The current catalogue package could not be downloaded.");
          return new Uint8Array(await response.arrayBuffer());
        },
      });
      if (result.source === "cache-unverified" || !currentManifest ||
          result.catalogue.schemaVersion !== currentManifest.schemaVersion || result.catalogue.contract !== currentManifest.contractVersion)
        throw new Error("The current Hospitality catalogue could not be verified.");
      if (this.stalePublicHash === result.contentHash) throw new Error("The booking catalogue is awaiting refresh.");
      this.stalePublicHash = undefined;
      const localChange = this.localCatalogueChange;
      this.localCatalogueChange = false;
      if (this.lastPublic?.hash === result.contentHash) return this.lastPublic;
      if (this.lastPublic && (this.lastPublic.productsById.size !== result.catalogue.items.length ||
          result.catalogue.items.some(item => !this.lastPublic!.productsById.has(item.id)))) {
        const currentIds = new Set(result.catalogue.items.map(item => item.id));
        for (const [id, draft] of this.drafts) {
          if (!currentIds.has(id)) { draft.invalidate(); this.drafts.delete(id); }
        }
        this.summaries.invalidate();
      }
      const adminNeedsCheck = Boolean(this.lastPublic && !localChange && this.admin.snapshot().value);
      this.lastPublic = indexPublicCatalogue(result);
      if (adminNeedsCheck) {
        if (this.adminViews) void this.loadAdmin("verify").catch(() => undefined);
        else if (!this.adminVersion) this.admin.invalidate();
      }
      return this.lastPublic;
    });
    this.publicQueue = work;
    return work;
  }, maxAge, force);

  loadAdmin = (mode: "cached" | "verify" | "full" = "cached") => {
    const previous = this.admin.snapshot().value;
    return this.admin.load(async () => {
      if (mode !== "full" && previous && this.adminVersion && Date.now() - this.adminLastFullRead < 30 * 60_000) {
        const response = await this.fetch("/api/catalogue/version");
        if (response.status !== 404) {
          if (!response.ok) throw new Error("Catalogue access or version could not be verified. Try again.");
          const head = await response.json() as { schemaVersion?: number; version?: string; canManage?: boolean };
          if (head.schemaVersion !== 1 || typeof head.version !== "string" || typeof head.canManage !== "boolean")
            throw new Error("The catalogue version response is unavailable. Try again.");
          if (head.version === this.adminVersion && head.canManage === previous.canManage) return previous;
        }
      }
      const response = await this.fetch("/api/catalogue");
      if (!response.ok) throw new Error("Catalogue access is unavailable. Check your access or try again.");
      const snapshot: unknown = await response.json();
      if (!isCataloguePayload(snapshot)) throw new Error("Catalogue information is unavailable. Try again.");
      this.adminVersion = response.headers.get("X-Fika-Catalogue-Version") ?? undefined;
      this.adminLastFullRead = Date.now();
      return snapshot;
    }, maxAge, mode !== "cached" && (mode === "full" || this.adminVersion !== undefined));
  };

  showAdmin = () => {
    this.adminViews++;
    void this.loadAdmin("verify").catch(() => undefined);
    return () => { this.adminViews--; };
  };

  loadBuilder = (force = false) => {
    const combine = this.catalogue.snapshot().status === "idle" && this.summaries.snapshot().status === "idle";
    const page = combine ? this.json<MenuIndexPage>("/api/studio/product-menus?includeCatalogueManifest=1") : undefined;
    return Promise.all([this.loadPublic(force, page), this.loadSummaries(force, page)]);
  };

  loadSummaries = (force = false, firstPage?: Promise<MenuIndexPage>) => this.summaries.load(async () => {
    const items: ProductMenuListing[] = [];
    let cursor: string | null = null;
    for (let count = 0; count < 20; count++) {
      const query = cursor ? "?" + new URLSearchParams({ cursor }) : "";
      const page: CursorPage<ProductMenuListing> = count === 0 && firstPage ? await firstPage : await this.json("/api/studio/product-menus" + query);
      items.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) return items;
    }
    throw new Error("Too many configured menus to verify in one session. Narrow the catalogue and try again.");
  }, maxAge, force);

  loadDishPage = (cursor?: string) => this.dishes.load(async () => {
    const previous = this.dishPageBeforeRead;
    const query = new URLSearchParams({ list: "dishes", ...(cursor ? { cursor } : {}) });
    const page = await this.json<CursorPage<Dish>>("/api/studio?" + query);
    const items = new Map((cursor ? previous?.items ?? [] : []).map(dish => [dish.id, dish]));
    for (const dish of page.items) items.set(dish.id, dish);
    for (const [id, dish] of this.mutations) {
      if ((items.get(id)?.version ?? 0) < dish.version) items.set(id, dish);
      else this.mutations.delete(id);
    }
    this.dishPageBeforeRead = { items: [...items.values()], nextCursor: page.nextCursor };
    return this.dishPageBeforeRead;
  }, maxAge, Boolean(cursor), Boolean(cursor));

  private dishPageBeforeRead?: CursorPage<Dish>;

  rememberDish = (dish: Dish) => {
    if (this.controller.signal.aborted) return;
    this.mutations.set(dish.id, dish);
    this.assigned.set(dish.id, dish);
    this.assignedCheckedAt.set(dish.id, Date.now());
    if (this.dishes.snapshot().status === "ready" && this.dishPageBeforeRead) {
      this.dishPageBeforeRead = { ...this.dishPageBeforeRead, items: remember(this.dishPageBeforeRead.items, dish, value => value.id, value => value.version) };
      this.dishes.set(this.dishPageBeforeRead);
    }
  };

  loadDraft(itemId: string, knownVersion?: number) {
    if (!this.catalogue.snapshot().value?.productsById.has(itemId))
      return Promise.reject(new Error("Choose a product from the current Hospitality catalogue."));
    let resource = this.drafts.get(itemId);
    if (!resource) { resource = new StudioReadResource(); this.drafts.set(itemId, resource); }
    return resource.load(async () => (await this.json<{ item: ProductMenuDraft | null }>(
      "/api/studio/product-menus?" + new URLSearchParams({ itemId }))).item,
    maxAge, knownVersion !== undefined && (resource.snapshot().value?.version ?? 0) < knownVersion);
  }

  private clearDrafts() {
    for (const draft of this.drafts.values()) draft.invalidate();
    this.drafts.clear();
  }

  rememberDraft(draft: ProductMenuDraft, summary: ProductMenuListing) {
    if (this.controller.signal.aborted) return;
    let resource = this.drafts.get(draft.itemId);
    if (!resource) { resource = new StudioReadResource(); this.drafts.set(draft.itemId, resource); }
    if ((resource.snapshot().value?.version ?? 0) <= draft.version) resource.set(draft);
    const items = this.summaries.snapshot().value;
    if (items) this.summaries.set(remember(items, summary, value => value.itemId, value => value.version));
    else this.summaries.invalidate();
  }

  private async hydrate<T>(keys: string[], cache: Map<string, T>, pending: Map<string, Promise<void>>,
    batchSize: number, read: (keys: string[]) => Promise<T[]>, keyOf: (item: T) => string) {
    const missing = keys.filter(key => !cache.has(key) && !pending.has(key));
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      const request = read(batch).then(items => {
        if (this.controller.signal.aborted || !Array.isArray(items)) throw new Error("Saved dishes could not be verified.");
        for (const item of items) {
          if (!batch.includes(keyOf(item))) throw new Error("An unexpected dish revision was returned.");
          if (!cache.has(keyOf(item))) cache.set(keyOf(item), item);
        }
      }).finally(() => { for (const key of batch) pending.delete(key); });
      for (const key of batch) pending.set(key, request);
    }
    await Promise.all(new Set(keys.map(key => pending.get(key))));
    return keys.flatMap(key => cache.has(key) ? [cache.get(key)!] : []);
  }

  loadRevisions = (keys: string[]) => this.hydrate(keys, this.revisions, this.revisionRequests, productMenuDishBatchSize,
    async batch => (await this.json<{ items: ProductMenuDish[] }>("/api/studio/product-menus?" + new URLSearchParams({ dishRevisions: batch.join(",") }))).items,
    dish => productMenuDishKey({ dishId: dish.id, revision: dish.version }));

  loadAssigned = (keys: string[]) => {
    for (const id of keys) {
      if (Date.now() - (this.assignedCheckedAt.get(id) ?? 0) >= maxAge) this.assigned.delete(id);
    }
    return this.hydrate(keys, this.assigned, this.assignedRequests, 24, async batch => {
      const { items } = await this.json<{ items: Dish[] }>("/api/studio?" + new URLSearchParams({ list: "assigned-dishes", ids: batch.join(",") }));
      for (const dish of items) this.assignedCheckedAt.set(dish.id, Date.now());
      return items;
    }, dish => dish.id);
  };

  catalogueChanged(receipt?: CatalogueCommandResult, startedFrom?: ReadState<CataloguePayload>) {
    if (this.controller.signal.aborted) return;
    const current = this.admin.snapshot();
    if (receipt && current.value && (!startedFrom || startedFrom === current)) {
      this.admin.set(applyCatalogueReceipt(current.value, receipt));
    } else this.admin.invalidate(new Error("Refresh the catalogue to verify the result of the last change."));
    this.localCatalogueChange = Boolean(receipt);
    if (receipt?.package === "stale") this.stalePublicHash = this.lastPublic?.hash;
    this.catalogue.invalidate(receipt?.package === "stale" ? new Error("The booking catalogue is awaiting refresh.") : undefined);
    if (!receipt) {
      this.clearDrafts();
      this.summaries.invalidate();
    }
    if (receipt?.package !== "stale") void this.loadPublic(true).catch(() => undefined);
    this.notifyCatalogueChange?.();
  }

  connect() {
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("fika-studio-catalogue-changes") : undefined;
    if (channel) {
      this.notifyCatalogueChange = () => channel.postMessage("changed");
      channel.onmessage = ({ data }) => {
        if (data !== "changed" || this.controller.signal.aborted) return;
        const loadedAdmin = this.admin.snapshot().status !== "idle";
        this.admin.invalidate();
        this.catalogue.invalidate();
        this.summaries.invalidate();
        this.clearDrafts();
        if (document.visibilityState === "visible") {
          void this.loadPublic(true).catch(() => undefined);
          if (loadedAdmin && this.adminViews) void this.loadAdmin().catch(() => undefined);
        }
      };
    }
    const revalidate = () => {
      if (document.visibilityState !== "visible" || this.controller.signal.aborted) return;
      if (this.adminViews) void this.loadAdmin("verify").catch(() => undefined);
      if (this.catalogue.snapshot().status !== "idle") void this.loadPublic(true).catch(() => undefined);
      else if (!this.adminViews) void this.fetch("/api/studio/access").catch(() => undefined);
    };
    const revalidateRestored = (event: PageTransitionEvent) => { if (event.persisted) revalidate(); };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pageshow", revalidateRestored);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("pageshow", revalidateRestored);
      channel?.close();
      this.notifyCatalogueChange = undefined;
    };
  }
}

const StudioReadContext = createContext<StudioReads | null>(null);

export function useStudioReads() {
  const reads = useContext(StudioReadContext);
  if (!reads) throw new Error("Studio read scope is unavailable.");
  return reads;
}

export function useStudioRead<T>(resource: StudioReadResource<T>) {
  return useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
}

export function StudioReadProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [reads] = useState(() => new StudioReads(scope));
  const admission = useStudioRead(reads.admission);
  useEffect(() => reads.connect(), [reads]);
  return <StudioReadContext.Provider value={reads}>
    {admission.value ? <main className="studio-admission fika-card">
      <h1>Hospitality Menu Studio</h1><p role="alert">{admission.value}</p>
      <a className="fika-button fika-button--primary" href="/">Reopen Studio</a>
    </main> : children}
  </StudioReadContext.Provider>;
}
