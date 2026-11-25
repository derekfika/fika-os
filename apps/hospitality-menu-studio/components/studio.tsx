"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  calendarDay,
  type Dish,
  type DraftVersion,
  type Menu,
  type Publication,
  type Review,
  type Section,
  type StudioActor,
} from "../lib/contract";
import { kitchenQuantities } from "../lib/review";
import { CatalogueView } from "./studio-catalogue";
import type { CatalogueRow } from "./catalogue-wire";
import { linkedStudioSections } from "./catalogue-governance-model";
import ProductMenuBuilder from "./product-menu-builder";
import type { ProductMenuSummary } from "./menu-builder-home";
import { StudioShell as FikaStudioShell, StudioStatus, type StudioDestination } from "./studio-design-system";
import { useAssignedDishes } from "./use-assigned-dishes";
import { MenuSetup, type NewMenuDetails } from "./menu-setup";
import type { CatalogueChoices, NewSectionDetails } from "./menu-setup-model";
import { DishCollection, DishEditor, KitchenPreview } from "./studio-dishes";
import { sectionDishIds } from "./studio-dish-collection-model";
import { VersionHistory } from "./studio-history";
import { MenuOverview, SectionEditor } from "./studio-menus";
import {
  BookingImpact,
  CollectionAvailability,
  CustomerPreview,
  PublicationReview,
  type SitePreview,
} from "./studio-preview";
import {
  Button,
  dateRange,
  Icon,
  PageHeading,
  Pill,
  title,
  type Page,
} from "./studio-ui";
import { request, useDraft } from "./use-studio-draft";
import { StudioRecovery } from "./studio-recovery";
import { acknowledgedPublication, type PublicationReceipt } from "./studio-review-model";
import {
  formatRetainedTime,
  retainedMetadataKey,
  retainedTimestamp,
} from "./studio-model";
import styles from "./studio.module.css";

type Entity = Menu | Dish;
type DishContext = "library" | "section" | "review";
type Recovery = {
  key: string;
  kind: "menu" | "dish";
  item: Entity;
  retainedAt: string | null;
};

export default function Studio({
  actor,
  demo,
  safetyAvailable,
  publishedKitchenAvailable,
  checkerOrigin,
}: {
  actor: StudioActor;
  demo: boolean;
  safetyAvailable: boolean;
  publishedKitchenAvailable: boolean;
  checkerOrigin?: string;
}) {
  const [catalogueItemId, setCatalogueItemId] = useState("");
  const [catalogueReturn, setCatalogueReturn] = useState(false);
  const [catalogueArea, setCatalogueArea] = useState<"products" | "sites" | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [builderProducts, setBuilderProducts] = useState<CatalogueRow[]>([]);
  const [builderSummaries, setBuilderSummaries] = useState<ProductMenuSummary[]>([]);
  const [builderActiveProductId, setBuilderActiveProductId] = useState<string | null>(null);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [requestedBuilderProductId, setRequestedBuilderProductId] = useState<string | null>(null);
  const [requestedBuilderDestination, setRequestedBuilderDestination] = useState<StudioDestination | null>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [menuCursor, setMenuCursor] = useState<string | null>(null);
  const [dishCursor, setDishCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [newSectionId, setNewSectionId] = useState("");
  const [week, setWeek] = useState(0);
  const [createKind, setCreateKind] = useState<Menu["kind"] | null>(null);
  const [dishContext, setDishContext] = useState<DishContext>("library");
  const [dishOpen, setDishOpen] = useState(false);
  const [kitchenReturn, setKitchenReturn] = useState<"dishes" | "activation">("dishes");
  const [collectionDishId, setCollectionDishId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [publication, setPublication] = useState<PublicationReceipt | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [history, setHistory] = useState<Publication[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draftVersions, setDraftVersions] = useState<DraftVersion[]>([]);
  const [boxCount, setBoxCount] = useState(1);
  const [reviewScope, setReviewScope] = useState({
    sectionId: "",
    week: "",
    dishId: "",
  });
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState("");
  const [catalogueChoices, setCatalogueChoices] = useState<CatalogueChoices>({
    state: "unchecked",
  });
  const checkingCatalogue = useRef(false);
  const [sitePreview, setSitePreview] = useState<SitePreview | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const [mappingSectionId, setMappingSectionId] = useState("");
  const [recoverable, setRecoverable] = useState<Recovery[]>([]);
  const reviewGeneration = useRef(0);
  const previewGeneration = useRef(0);

  function rememberMenu(saved: Menu) {
    setMenus((list) => {
      const current = list.find((item) => item.id === saved.id);
      if (current && current.version > saved.version) return list;
      return [saved, ...list.filter((item) => item.id !== saved.id)];
    });
  }
  const menuDraft = useDraft<Menu>(actor, "menu", null, rememberMenu);
  const dishDraft = useDraft<Dish>(actor, "dish", null, (saved) =>
    setDishes((list) => [
      saved,
      ...list.filter((item) => item.id !== saved.id),
    ]),
  );
  const handleBuilderProductsLoaded = useCallback((products: CatalogueRow[], summaries: ProductMenuSummary[]) => {
    setBuilderProducts(products);
    setBuilderSummaries(summaries);
  }, []);
  const handleBuilderActiveProduct = useCallback((itemId: string | null) => setBuilderActiveProductId(itemId), []);
  const handleBuilderDirtyChange = useCallback((dirty: boolean) => setBuilderDirty(dirty), []);
  const handleBuilderProductRequest = useCallback(() => setRequestedBuilderProductId(null), []);
  const handleBuilderNavigation = useCallback(() => setRequestedBuilderDestination(null), []);
  const builderLinks = builderSummaries.flatMap((summary) => {
    const product = builderProducts.find((item) => item.itemId === summary.itemId);
    return product ? [{ id: summary.itemId, name: product.name, status: "Draft", summary: summary.kind === "fixed" ? `Fixed · ${summary.dishCount ?? 0} dishes` : `${summary.cycleWeeks}-week rotation` }] : [];
  });
  const activeDestination: StudioDestination = page === "dishes" || page === "kitchen" ? "library" : page === "products" || page === "sites" ? "catalogue" : "builder";
  const navigateDestination = useCallback((destination: StudioDestination) => {
    if (page === "home") {
      setRequestedBuilderDestination(destination);
      return true;
    }
    if (destination === "builder") navigate("home");
    else if (destination === "library") navigate("dishes");
    else { setCatalogueArea("products"); navigate("products"); }
    return true;
  }, [page]);
  const selectBuilderProduct = useCallback((itemId: string) => {
    if (page !== "home") setPage("home");
    setRequestedBuilderProductId(itemId);
    return true;
  }, [page]);
  const menu = menuDraft.item;
  const dish = dishDraft.item;
  const activeMenuId = useRef(menu?.id);
  activeMenuId.current = menu?.id;
  const publicationAllowed = actor.canPublish &&
    (!actor.publicationPilot || actor.publicationPilot.menuId === menu?.id);
  const section = menu?.sections.find((item) => item.id === sectionId);
  const assignedDishes = useAssignedDishes(section ? sectionDishIds(section) : [], dishes);
  const sectionDishes = [...dishes, ...assignedDishes.items];
  const unresolvedDishLabel = assignedDishes.loading
    ? "Loading dish name..."
    : assignedDishes.error
      ? "Dish name could not be loaded"
      : "Dish unavailable";
  const selected =
    section?.mode === "static"
      ? section.staticDishIds
      : section?.weeks[week] || [];
  const day = calendarDay(eventDate);
  const anchor = calendarDay(menu?.anchorMonday || "");
  const previewValid = Boolean(
    menu &&
    day >= calendarDay(menu.startDate) &&
    day <= calendarDay(menu.endDate) &&
    (!menu.sections.some((item) => item.mode === "rotation") ||
      (Number.isFinite(anchor) && new Date(anchor).getUTCDay() === 1)),
  );
  const kitchenCollection =
    page === "kitchen" &&
    kitchenReturn === "activation" &&
    menu?.kind === "collection"
      ? menu
      : null;
  const collectionDishIds = kitchenCollection
    ? new Set(
        kitchenCollection.sections.flatMap((section) =>
          section.mode === "static"
            ? section.staticDishIds
            : section.weeks.flat(),
        ),
      )
    : null;
  const kitchenChoices = collectionDishIds
    ? dishes.filter((item) => collectionDishIds.has(item.id))
    : [];
  const kitchenDish = kitchenCollection
    ? kitchenChoices.find((item) => item.id === collectionDishId) ||
      kitchenChoices[0] ||
      null
    : dish;
  let kitchen: ReturnType<typeof kitchenQuantities> | null = null;
  if (kitchenDish?.assortment && page === "kitchen") {
    try {
      kitchen = kitchenQuantities(kitchenDish, boxCount);
    } catch {
      /* Incomplete draft quantities are explained in the preview. */
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [menuPage, dishPage] = await Promise.all([
        request(undefined, "?list=menus"),
        request(undefined, "?list=dishes"),
      ]);
      setMenus(menuPage.items);
      setDishes(dishPage.items);
      setMenuCursor(menuPage.nextCursor);
      setDishCursor(dishPage.nextCursor);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const destination = new URLSearchParams(window.location.search).get("page");
    if (destination === "library") setPage("dishes");
    if (destination === "catalogue") { setCatalogueArea("products"); setPage("products"); }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, sectionId, createKind, menu?.id, dish?.id]);

  function readRetainedTime(key: string, raw: string): string | null {
    try {
      return retainedTimestamp(
        raw,
        localStorage.getItem(retainedMetadataKey(key)),
      );
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (page !== "home") return;
    const copies: Recovery[] = [];
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        for (const kind of ["menu", "dish"] as const) {
          if (!key?.startsWith("fika-studio:" + actor.id + ":" + kind + ":"))
            continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const item = JSON.parse(raw) as Entity;
            if (item.id)
              copies.push({
                key,
                kind,
                item,
                retainedAt: readRetainedTime(key, raw),
              });
          } catch {
            /* Preserve unreadable entries. */
          }
        }
      }
    } catch {
      /* Device storage is unavailable. */
    }
    setRecoverable(copies);
  }, [actor.id, page]);

  useEffect(() => {
    reviewGeneration.current++;
    setReview(null);
  }, [menu, effectiveDate, reviewScope]);
  useEffect(() => {
    previewGeneration.current++;
    setSitePreview(null);
    setPreviewMessage("");
  }, [menu, eventDate, siteId]);
  useEffect(() => {
    setHistory([]);
    setHistoryLoaded(false);
    setDraftVersions([]);
    setReviewScope({ sectionId: "", week: "", dishId: "" });
  }, [menu?.id]);

  function navigate(next: Page) {
    if (typeof window !== "undefined") {
      const destination = next === "dishes" ? "/?page=library" : next === "products" || next === "sites" ? "/?page=catalogue" : "/";
      window.history.replaceState(null, "", destination);
    }
    if (next === "products" || next === "sites") {
      setCatalogueArea(next);
      if (page === "products" || page === "sites") {
        setPage(next);
        return;
      }
    }
    setCatalogueReturn(false);
    setCatalogueItemId("");
    setPage(next);
    setCreateKind(null);
    setSectionId("");
    setDishContext("library");
    setDishOpen(false);
    setActionError("");
    if (next === "menus" || next === "collections") menuDraft.open(null);
  }

  function openMenu(item: Menu) {
    menuDraft.open(item);
    setSectionId("");
    setWeek(0);
    setEventDate(item.startDate);
    setEffectiveDate("");
    setActionError("");
    setPage("menus");
  }
  function openSection(id: string) {
    setNewSectionId("");
    setSectionId(id);
    setMappingSectionId("");
    setWeek(0);
    setPreviewMessage("");
  }
  function openLinkedSection(menuId: string, linkedSectionId: string) {
    const linked = menu?.id === menuId ? menu : menus.find((item) => item.id === menuId);
    if (!linked?.sections.some((item) => item.id === linkedSectionId)) return;
    if (menu?.id !== menuId) openMenu(linked);
    if (menu?.id !== menuId || sectionId !== linkedSectionId) openSection(linkedSectionId);
    setCatalogueReturn(false);
    setDishOpen(false);
    setPage("menus");
  }
  function reviseSection(change: Partial<Section>) {
    menuDraft.change((item) => ({
      ...item,
      sections: item.sections.map((value) =>
        value.id === sectionId ? { ...value, ...change } : value,
      ),
    }));
  }
  function updateSelected(ids: string[]) {
    if (!section) return;
    reviseSection(
      section.mode === "static"
        ? { staticDishIds: ids }
        : {
            weeks: section.weeks.map((previous, index) =>
              index === week ? ids : previous,
            ),
          },
    );
  }
  function newMenu({ baseId, ...details }: NewMenuDetails) {
    const base = menus.find((item) => item.id === baseId);
    openMenu({
      ...details,
      id: crypto.randomUUID(),
      version: 0,
      updatedAt: "",
      sections: base
        ? structuredClone(base.sections).map((item) => ({
            ...item,
            id: crypto.randomUUID(),
          }))
        : [],
    });
    setCreateKind(null);
  }
  function addSection(details: NewSectionDetails) {
    const id = crypto.randomUUID();
    menuDraft.change((item) => ({
      ...item,
      sections: [
        ...item.sections,
        {
          id,
          ...details,
          catalogueItemId: "",
          staticDishIds: [],
          weeks: Array.from({ length: 6 }, () => []),
        },
      ],
    }));
    openSection(id);
    setNewSectionId(id);
  }
  function showDishCollection(context: DishContext) {
    setDishContext(context);
    setDishOpen(false);
    setActionError("");
    setPage("dishes");
  }
  function openDish(item: Dish, context: DishContext = "library") {
    if (item.id !== dish?.id) dishDraft.open(item);
    setDishContext(context);
    setDishOpen(true);
    setActionError("");
    setPage("dishes");
  }
  function newDish(context: DishContext = "library") {
    openDish(
      {
        id: crypto.randomUUID(),
        version: 0,
        name: "",
        category: "other",
        temperature: null,
        customerDescription: "",
        kitchenDescription: "",
        assortment: null,
        updatedAt: "",
      },
      context,
    );
  }
  function showKitchen(from: "dishes" | "activation") {
    setKitchenReturn(from);
    setCollectionDishId("");
    setBoxCount(1);
    setPage("kitchen");
  }
  function showReview() {
    setActionError("");
    setPage("review");
  }
  function showPreview() {
    setEventDate(eventDate || menu?.startDate || "");
    setPreviewMessage("");
    setPage("preview");
  }
  async function recoverDraft({ key, kind, item }: Recovery) {
    try {
      const query = new URLSearchParams({
        [kind === "menu" ? "menuId" : "dishId"]: item.id,
      });
      let savedVersion: number;
      try {
        const latest = await request(undefined, `?${query}`);
        if (
          !latest.item ||
          latest.item.id !== item.id ||
          !Number.isInteger(latest.item.version) ||
          latest.item.version < 1
        )
          throw new Error("Invalid saved draft");
        savedVersion = latest.item.version;
      } catch (failure) {
        if (
          item.version !== 0 ||
          (failure as Error & { status?: number }).status !== 404
        )
          throw failure;
        savedVersion = 0;
      }
      if (kind === "menu") {
        menuDraft.recover(item as Menu, key, savedVersion);
        setSectionId("");
        setPage("menus");
      } else {
        dishDraft.recover(item as Dish, key, savedVersion);
        setDishContext("library");
        setDishOpen(true);
        setPage("dishes");
      }
    } catch {
      setError(
        "The saved draft could not be checked. Your retained copy remains on this device; try again.",
      );
    }
  }

  async function runAction(body: unknown) {
    setActionBusy(true);
    setActionError("");
    try {
      return await request(body);
    } catch (failure) {
      setActionError((failure as Error).message);
      return null;
    } finally {
      setActionBusy(false);
    }
  }
  async function loadSites() {
    if (checkingCatalogue.current) return;
    checkingCatalogue.current = true;
    setCatalogueChoices({ state: "loading" });
    setPreviewMessage("");
    try {
      const result = await request(undefined, "?list=catalogue");
      if (!Array.isArray(result.sites) || !Array.isArray(result.items))
        throw new Error("Catalogue is unavailable.");
      setSites(result.sites);
      setCatalogueChoices({ state: "loaded", items: result.items });
      if (!result.sites.length)
        setPreviewMessage("No sites are available from the catalogue.");
    } catch {
      setSites([]);
      setCatalogueChoices({ state: "unavailable" });
      setPreviewMessage(
        "The catalogue is unavailable. Site and booking availability are unknown. Saved mappings are retained.",
      );
    } finally {
      checkingCatalogue.current = false;
    }
  }
  async function checkSitePreview() {
    if (!menu || !siteId || !eventDate) return;
    const generation = previewGeneration.current;
    setSitePreview(null);
    setActionBusy(true);
    setPreviewMessage("");
    try {
      const params = new URLSearchParams({
        menuId: menu.id,
        eventDate,
        siteId,
      });
      const result = await request(undefined, "?" + params);
      if (!Array.isArray(result.items) || !result.catalogue)
        throw new Error("Site eligibility evidence is unavailable.");
      if (generation === previewGeneration.current) setSitePreview(result);
    } catch {
      if (generation === previewGeneration.current) {
        setSitePreview(null);
        setPreviewMessage(
          "Site offerings could not be checked. Try again; customer availability remains unknown.",
        );
      }
    } finally {
      setActionBusy(false);
    }
  }
  async function loadMore(list: "menus" | "dishes") {
    const cursor = list === "menus" ? menuCursor : dishCursor;
    if (!cursor) return;
    setActionBusy(true);
    setActionError("");
    try {
      const result = await request(
        undefined,
        "?" + new URLSearchParams({ list, cursor }),
      );
      if (list === "menus") {
        setMenus((values) => [...values, ...result.items]);
        setMenuCursor(result.nextCursor);
      } else {
        setDishes((values) => [...values, ...result.items]);
        setDishCursor(result.nextCursor);
      }
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function loadHistory(list: "history" | "versions") {
    if (!menu) return;
    setActionBusy(true);
    setActionError("");
    try {
      const result = await request(
        undefined,
        "?" + new URLSearchParams({ list, menuId: menu.id }),
      );
      if (activeMenuId.current !== menu.id) return;
      if (!Array.isArray(result.items) || (list === "history" &&
        result.items.some((item: Publication) => item?.menuId !== menu.id)))
        throw new Error("History is unavailable.");
      if (list === "history") {
        setHistory(result.items);
        setHistoryLoaded(true);
      } else {
        setDraftVersions(result.items);
        if (result.nextCursor)
          setActionError("Showing the first page of draft versions.");
      }
    } catch (failure) {
      if (activeMenuId.current === menu.id) setActionError((failure as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function compareDrafts(fromVersion: number, toVersion: number) {
    if (!menu) throw new Error("Select a menu draft first.");
    const params = new URLSearchParams({
      menuId: menu.id,
      fromVersion: String(fromVersion),
      toVersion: String(toVersion),
    });
    const result = await request(undefined, "?" + params);
    if (
      !Array.isArray(result.changes) ||
      !result.changes.every((change: unknown) => typeof change === "string")
    ) {
      throw new Error("Draft comparison is unavailable.");
    }
    return result.changes as string[];
  }
  async function acceptRestore(body: unknown) {
    const result = await runAction(body);
    if (!result?.item) return;
    rememberMenu(result.item);
    menuDraft.open(result.item);
    setPage("menus");
    setActionError(
      typeof result.restoredVersion === "number" &&
        result.item.version > result.restoredVersion
        ? "Restore acknowledged as version " +
            result.restoredVersion +
            ". The latest draft is now version " +
            result.item.version +
            "."
        : "Draft restored as a new version.",
    );
  }

  const scope = {
    ...(reviewScope.sectionId ? { sectionId: reviewScope.sectionId } : {}),
    ...(reviewScope.week ? { week: Number(reviewScope.week) } : {}),
    ...(reviewScope.dishId ? { dishId: reviewScope.dishId } : {}),
  };
  async function checkReview() {
    if (!menu) return;
    const generation = reviewGeneration.current;
    const result = await runAction({
      action: "review",
      menuId: menu.id,
      version: menu.version,
      effectiveDate,
      scope,
    });
    if (generation === reviewGeneration.current)
      setReview(result as Review | null);
  }
  async function publish() {
    if (
      !menu ||
      !publicationAllowed ||
      !review?.canPublish ||
      review.safety.status !== "verified" ||
      !review.reviewToken ||
      menuDraft.state !== "saved"
    )
      return;
    const result = await runAction({
      action: "publish",
      menuId: menu.id,
      version: menu.version,
      effectiveDate,
      scope,
      reviewToken: review.reviewToken,
      confirmed: true,
    });
    if (result && activeMenuId.current === menu.id) {
      setReview(null);
      const receipt = acknowledgedPublication(result.publication, menu.id);
      if (receipt) setPublication(receipt);
      else setActionError("Studio did not confirm this publication. Check its history before retrying.");
    }
  }
  function viewHistory() {
    setActionError("");
    setPage("history");
    void loadHistory("history");
  }

  const menuSave = {
    state: menuDraft.state,
    error: menuDraft.error,
    retry: () => void menuDraft.retry(),
  };
  const dishSave = {
    state: dishDraft.state,
    error: dishDraft.error,
    retry: () => void dishDraft.retry(),
  };
  const dishProps = dish
    ? {
        dish,
        save: dishSave,
        canManage: actor.canManage,
        update: dishDraft.change,
      }
    : null;
  const menuList =
    page === "collections"
      ? menus.filter((item) => item.kind === "collection")
      : menus.filter((item) => item.kind === "seasonal");
  const menuBack = () =>
    navigate(menu?.kind === "collection" ? "collections" : "menus");
  const contextualDish = dishContext === "section" && Boolean(menu && section);
  const dishContextLabel = dishContext === "review" ? "Review changes" : "Section editor";
  const backFromDishes = () => setPage(dishContext === "review" ? "review" : "menus");
  const dishBack = () => {
    setDishOpen(false);
    if (dishContext !== "library") backFromDishes();
  };
  const libraryMenus = menu ? [menu, ...menus.filter((item) => item.id !== menu.id)] : menus;
  const showActivation =
    menu?.kind === "collection"
      ? () => {
          setActionError("");
          setPage("activation");
        }
      : undefined;

  return (
    <FikaStudioShell
      actorName={actor.name}
      active={activeDestination}
      onNavigate={navigateDestination}
      navigationHrefs={{ builder: "/", library: "/?page=library", catalogue: "/?page=catalogue" }}
      productLinks={builderLinks}
      activeProductId={builderActiveProductId || undefined}
      onSelectProduct={selectBuilderProduct}
      environmentLabel={demo ? <StudioStatus tone="info">Local preview</StudioStatus> : undefined}
      saveState={builderActiveProductId ? <StudioStatus tone={builderDirty ? "warning" : "success"}>{builderDirty ? "Unsaved changes" : "Draft saved"}</StudioStatus> : menu ? <StudioStatus tone={menuDraft.state === "saved" ? "success" : menuDraft.state === "error" ? "danger" : "warning"}>{menuDraft.state === "saved" ? "Draft saved" : menuDraft.state === "saving" ? "Saving…" : menuDraft.state === "conflict" ? "Version conflict" : "Unsaved changes"}</StudioStatus> : undefined}
      contentWidth={page === "home" ? (builderActiveProductId ? "wide" : "standard") : "wide"}
    >
      {page !== "home" &&
        page !== "dishes" &&
        menuDraft.state === "conflict" &&
        menu && (
          <StudioRecovery
            item={menu}
            retainedAt={menuDraft.retainedAt}
            openLatest={menuDraft.openLatest}
            dishes={dishes}
          />
        )}
      {page === "dishes" && dishOpen &&
        dishDraft.state === "conflict" &&
        dish && (
          <StudioRecovery
            item={dish}
            retainedAt={dishDraft.retainedAt}
            openLatest={dishDraft.openLatest}
            dishes={dishes}
          />
        )}
      {page === "home" && <ProductMenuBuilder
        actorName={actor.name}
        canManage={actor.canManage}
        embedded
        requestedProductId={requestedBuilderProductId}
        requestedDestination={requestedBuilderDestination}
        onProductRequestHandled={handleBuilderProductRequest}
        onNavigationHandled={handleBuilderNavigation}
        onDirtyStateChange={handleBuilderDirtyChange}
        onProductsLoaded={handleBuilderProductsLoaded}
        onActiveProductChange={handleBuilderActiveProduct}
        onNavigate={(destination) => {
          if (destination === "library") navigate("dishes");
          else if (destination === "catalogue") { setCatalogueArea("products"); navigate("products"); }
          else navigate("home");
        }}
      />}
      {page === "home" && recoverable.length > 0 && (
        <section className={styles.panelBody}>
          <h2>Unsaved drafts on this device</h2>
          <p>Choose a retained copy to review. A newer saved draft stays separate from this copy.</p>
          {recoverable.map((copy) => <button type="button" className={styles.listButton} key={copy.key} onClick={() => void recoverDraft(copy)}>
            <strong>{copy.item.name || "Untitled draft"}</strong>
            <span>{title(copy.kind)} · Started from version {copy.item.version} · {copy.retainedAt ? `Retained ${formatRetainedTime(copy.retainedAt)} ·` : "Time unavailable ·"} Copy {copy.key.slice(-8)} <Icon name="forward" /></span>
          </button>)}
        </section>
      )}
      {loading && page !== "home" && <p role="status">Loading menus and dishes…</p>}
      {error && page !== "home" && (
        <div className="fika-notice fika-notice--danger" role="alert">
          {error} <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}
      {!loading && catalogueArea && (
        <div hidden={Boolean(createKind) || (page !== "products" && page !== "sites")}>
          <CatalogueView
            area={catalogueArea}
            initialItemId={catalogueItemId}
            back={catalogueReturn ? () => setPage("menus") : undefined}
            sectionsFor={(id) => linkedStudioSections(libraryMenus, (value) => value.catalogueItemId === id)}
            openSection={openLinkedSection}
          />
        </div>
      )}
      {!loading && page !== "home" &&
        (createKind ? (
          <MenuSetup
            initialKind={createKind}
            menus={menus}
            close={() => setCreateKind(null)}
            create={newMenu}
          />
        ) : (
          <>
            {(page === "menus" || page === "collections") && !menu && (
              <>
                <PageHeading
                  title={
                    page === "menus" ? "Seasonal menus" : "Special collections"
                  }
                >
                  <Button
                    primary
                    disabled={!actor.canManage}
                    onClick={() =>
                      setCreateKind(
                        page === "menus" ? "seasonal" : "collection",
                      )
                    }
                  >
                    <Icon name="plus" />{" "}
                    {page === "menus" ? "New menu" : "New collection"}
                  </Button>
                </PageHeading>
                <div className={styles.panel}>
                  {menuList.map((item) => (
                    <button
                      type="button"
                      className={styles.listButton}
                      key={item.id}
                      onClick={() => openMenu(item)}
                    >
                      <strong>{item.name || "Untitled draft"}</strong>
                      <span>
                        <Pill tone="info">Draft</Pill>{" "}
                        {dateRange(item.startDate, item.endDate)}{" "}
                        <Icon name="forward" />
                      </span>
                    </button>
                  ))}
                  {!menuList.length && (
                    <p className={styles.empty}>
                      No matching menus in the loaded drafts.
                    </p>
                  )}
                </div>
                {menuCursor && (
                  <Button
                    disabled={actionBusy}
                    onClick={() => void loadMore("menus")}
                  >
                    Load more menus
                  </Button>
                )}
                {actionError && <p role="status">{actionError}</p>}
              </>
            )}
            {page === "menus" && menu && !section && (
              <>
                {actionError && (
                  <p role="status" className="fika-notice">
                    {actionError}
                  </p>
                )}
                <MenuOverview
                  menu={menu}
                  save={menuSave}
                  canManage={actor.canManage}
                  back={menuBack}
                  preview={showPreview}
                  review={showReview}
                  history={viewHistory}
                  activation={showActivation}
                  openSection={openSection}
                  addSection={addSection}
                  update={(values) =>
                    menuDraft.change((item) => ({ ...item, ...values }))
                  }
                />
              </>
            )}
            {menu &&
              section &&
              (page === "menus" ||
                ((page === "products" || page === "sites") && catalogueReturn) ||
                page === "preview" ||
                page === "review" ||
                page === "impact" ||
                (dishContext !== "library" &&
                  (page === "dishes" ||
                    (page === "kitchen" &&
                      kitchenReturn !== "activation")))) && (
                <div hidden={page !== "menus"}>
                  {assignedDishes.loading && (
                    <p role="status">Loading assigned dish names...</p>
                  )}
                  {assignedDishes.error && (
                    <div role="alert">
                      <p>{assignedDishes.error}</p>
                      <Button onClick={assignedDishes.retry}>
                        Retry loading assigned dishes
                      </Button>
                    </div>
                  )}
                  {!assignedDishes.loading &&
                    !assignedDishes.error &&
                    assignedDishes.missing.length > 0 && (
                      <p role="status">
                        {assignedDishes.missing.length} assigned{" "}
                        {assignedDishes.missing.length === 1
                          ? "dish is"
                          : "dishes are"}{" "}
                        unavailable. Their assignments are retained.
                      </p>
                    )}
                  <SectionEditor
                    key={section.id}
                    menu={menu}
                    section={section}
                    dishes={sectionDishes}
                    unresolvedDishLabel={unresolvedDishLabel}
                    selected={selected}
                    week={week}
                    setWeek={setWeek}
                    save={menuSave}
                    canManage={actor.canManage}
                    update={reviseSection}
                    updateSelected={updateSelected}
                    remove={() => {
                      menuDraft.change((item) => ({
                        ...item,
                        sections: item.sections.filter(
                          (row) => row.id !== sectionId,
                        ),
                      }));
                      setSectionId("");
                    }}
                    back={() => setSectionId("")}
                    preview={showPreview}
                    review={showReview}
                    editDish={(item) => openDish(item, "section")}
                    browseDishes={() => showDishCollection("section")}
                    createDish={() => newDish("section")}
                    active={page === "menus"}
                    focusName={newSectionId === section.id}
                    loadMore={
                      dishCursor ? () => void loadMore("dishes") : undefined
                    }
                    catalogue={catalogueChoices}
                    loadCatalogue={() => void loadSites()}
                    inspectItem={(id) => {
                      setCatalogueItemId(id);
                      setCatalogueReturn(true);
                      setCatalogueArea("products");
                      setPage("products");
                    }}
                    openSettings={mappingSectionId === section.id}
                    openSection={openSection}
                    busy={actionBusy}
                  />
                </div>
              )}
            {(page === "dishes" || (page === "kitchen" && kitchenReturn === "dishes")) && (
              <div hidden={page !== "dishes" || dishOpen}>
                <DishCollection
                  key={dishContext === "review" ? menu?.id : dishContext}
                  dishes={dishContext === "review" ? sectionDishes : dishes}
                  menus={libraryMenus}
                  canManage={actor.canManage}
                  create={() => newDish(dishContext)}
                  edit={(item) => openDish(item, dishContext)}
                  back={dishContext === "library" ? undefined : backFromDishes}
                  backLabel={dishContextLabel}
                  initialMenuId={dishContext === "review" ? menu?.id : undefined}
                  busy={actionBusy}
                  error={actionError}
                  loadMore={dishCursor ? () => void loadMore("dishes") : undefined}
                />
              </div>
            )}
            {page === "dishes" && dishOpen && dishProps && (
              <DishEditor
                {...dishProps}
                safetyAvailable={safetyAvailable}
                checkerOrigin={checkerOrigin}
                back={dishBack}
                backLabel={dishContext === "library" ? "Dish collection" : dishContextLabel}
                menuContext={contextualDish && menu && section ? {
                  name: menu.name,
                  sectionName: section.name,
                } : undefined}
                assignments={dish ? linkedStudioSections(libraryMenus, (value) => sectionDishIds(value).includes(dish.id)) : []}
                openAssignment={openLinkedSection}
                kitchen={() => showKitchen("dishes")}
              />
            )}
            {page === "preview" && menu && (
              <CustomerPreview
                key={menu.id}
                menu={menu}
                dishes={sectionDishes}
                date={eventDate}
                setDate={setEventDate}
                initialSection={sectionId}
                valid={previewValid}
                saved={menuDraft.state === "saved"}
                busy={actionBusy || catalogueChoices.state === "loading"}
                sites={sites}
                siteId={siteId}
                setSite={setSiteId}
                loadSites={() => void loadSites()}
                checkSite={() => void checkSitePreview()}
                sitePreview={sitePreview}
                notice={previewMessage}
                back={() => setPage("menus")}
                review={showReview}
                openMapping={(id) => {
                  setSectionId(id);
                  setMappingSectionId(id);
                  setWeek(0);
                  setPreviewMessage("");
                  setPage("menus");
                }}
              />
            )}
            {page === "review" && menu && (
              <PublicationReview
                key={menu.id}
                menu={menu}
                dishes={sectionDishes}
                date={effectiveDate}
                setDate={setEffectiveDate}
                scope={reviewScope}
                setSection={(id) =>
                  setReviewScope((previous) => ({
                    ...previous,
                    sectionId: id,
                    week: "",
                    dishId: "",
                  }))
                }
                setWeek={(value) =>
                  setReviewScope((previous) => ({ ...previous, week: value, dishId: "" }))
                }
                setDish={(id) =>
                  setReviewScope((previous) => ({ ...previous, dishId: id }))
                }
                result={review}
                publication={publication?.menuId === menu.id ? publication : null}
                busy={actionBusy}
                save={menuSave}
                canPublish={publicationAllowed}
                publicationBlockedReason={publicationAllowed ? "" : actor.canPublish
                  ? "This menu is outside the authorised publication scope."
                  : "Publishing requires Studio publication access."}
                notice={actionError}
                back={() => setPage("menus")}
                check={() => void checkReview()}
                impact={() => setPage("impact")}
                reviewDishes={() => showDishCollection("review")}
                viewHistory={viewHistory}
                editIssue={(target) => {
                  if (target.kind === "dish") {
                    const targetDish = sectionDishes.find(
                      (item) => item.id === target.id,
                    );
                    if (targetDish) openDish(targetDish, "review");
                    return;
                  }
                  if (target.kind === "section") {
                    openSection(target.id);
                    if (target.mapping) setMappingSectionId(target.id);
                  } else setSectionId("");
                  setPage("menus");
                }}
                publish={() => void publish()}
              />
            )}
            {page === "impact" && menu && (
              <BookingImpact
                menu={menu}
                result={review}
                back={() => setPage("review")}
              />
            )}
            {page === "history" && menu && (
              <VersionHistory
                key={menu.id + ":" + menu.version}
                menu={menu}
                versions={draftVersions}
                history={history}
                historyLoaded={historyLoaded}
                canPreviewPublishedKitchen={publishedKitchenAvailable}
                loadVersions={() => void loadHistory("versions")}
                loadHistory={() => void loadHistory("history")}
                compare={compareDrafts}
                restoreDraft={(sourceVersion) =>
                  void acceptRestore({
                    action: "restore-draft",
                    menuId: menu.id,
                    version: menu.version,
                    sourceVersion,
                    confirmed: true,
                  })
                }
                restorePublication={(publicationId) =>
                  void acceptRestore({
                    action: "restore-menu",
                    menuId: menu.id,
                    version: menu.version,
                    publicationId,
                  })
                }
                back={() => setPage("menus")}
                canManage={actor.canManage}
                canPublish={actor.canPublish}
                busy={actionBusy}
                saved={menuDraft.state === "saved"}
                notice={actionError}
              />
            )}
            {(page === "review" || page === "history") && !menu && (
              <>
                <PageHeading
                  title={
                    page === "review"
                      ? "Review changes"
                      : "Versions and history"
                  }
                />
                <p>
                  Open a menu draft to{" "}
                  {page === "review"
                    ? "review its changes"
                    : "view its versions"}
                  .
                </p>
                <Button onClick={() => navigate("menus")}>Go to menus</Button>
              </>
            )}
            {page === "activation" && menu?.kind === "collection" && (
              <CollectionAvailability
                menu={menu}
                history={history}
                historyLoaded={historyLoaded}
                loadHistory={() => void loadHistory("history")}
                busy={actionBusy}
                back={() => setPage("menus")}
                kitchen={() => showKitchen("activation")}
                notice={actionError}
              />
            )}
            {page === "kitchen" && (kitchenDish || kitchenCollection) && (
              <KitchenPreview
                dish={kitchenDish}
                choices={kitchenCollection ? kitchenChoices : undefined}
                chooseDish={setCollectionDishId}
                loadMore={
                  kitchenCollection && dishCursor
                    ? () => void loadMore("dishes")
                    : undefined
                }
                busy={actionBusy}
                boxCount={boxCount}
                setBoxCount={setBoxCount}
                quantities={kitchen}
                back={() => setPage(kitchenReturn)}
                activation={showActivation}
              />
            )}
          </>
        ))}
    </FikaStudioShell>
  );
}
