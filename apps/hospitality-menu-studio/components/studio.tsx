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
import {
  MenuDashboard,
  MenuWizard,
  type NewMenuDetails,
} from "./studio-dashboard";
import {
  AssortmentBuilder,
  DishCollection,
  DishEditor,
  KitchenPreview,
} from "./studio-dishes";
import { VersionHistory } from "./studio-history";
import { MenuOverview, SectionEditor } from "./studio-menus";
import {
  BookingImpact,
  CollectionActivation,
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
  StudioShell,
  title,
  type Page,
} from "./studio-ui";
import { request, useDraft } from "./use-studio-draft";
import styles from "./studio.module.css";

type Entity = Menu | Dish;
type Recovery = { key: string; kind: "menu" | "dish"; item: Entity };

export default function Studio({
  actor,
  demo,
}: {
  actor: StudioActor;
  demo: boolean;
}) {
  const [page, setPage] = useState<Page>("home");
  const [menus, setMenus] = useState<Menu[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [menuCursor, setMenuCursor] = useState<string | null>(null);
  const [dishCursor, setDishCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [week, setWeek] = useState(0);
  const [createKind, setCreateKind] = useState<Menu["kind"] | null>(null);
  const [dishBackToSection, setDishBackToSection] = useState(false);
  const [kitchenReturn, setKitchenReturn] = useState<
    "dishes" | "assortment" | "activation"
  >("dishes");
  const [collectionDishId, setCollectionDishId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [review, setReview] = useState<Review | null>(null);
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
  const [visibility, setVisibility] = useState<"staff" | "customer">("staff");
  const [activationId, setActivationId] = useState("");
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState("");
  const [catalogueItems, setCatalogueItems] = useState<typeof sites>([]);
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
  const menu = menuDraft.item;
  const dish = dishDraft.item;
  const section = menu?.sections.find((item) => item.id === sectionId);
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
    window.scrollTo(0, 0);
  }, [page, sectionId, createKind, menu?.id, dish?.id]);

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
            if (item.id) copies.push({ key, kind, item });
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
    setActivationId("");
    setActivationConfirmed(false);
  }, [menu?.id]);

  function navigate(next: Page) {
    setPage(next);
    setCreateKind(null);
    setSectionId("");
    setActionError("");
    if (next === "menus" || next === "collections") menuDraft.open(null);
    if (next === "dishes") dishDraft.open(null);
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
    setSectionId(id);
    setMappingSectionId("");
    setWeek(0);
    setPreviewMessage("");
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
  function addSection() {
    const id = crypto.randomUUID();
    menuDraft.change((item) => ({
      ...item,
      sections: [
        ...item.sections,
        {
          id,
          name: "New section",
          mode: "static",
          catalogueItemId: "",
          staticDishIds: [],
          weeks: Array.from({ length: 6 }, () => []),
        },
      ],
    }));
    openSection(id);
  }
  function openDish(item: Dish, fromSection = false) {
    dishDraft.open(item);
    setDishBackToSection(fromSection);
    setActionError("");
    setPage("dishes");
  }
  function newDish() {
    openDish({
      id: crypto.randomUUID(),
      version: 0,
      name: "",
      category: "other",
      temperature: null,
      customerDescription: "",
      kitchenDescription: "",
      assortment: null,
      updatedAt: "",
    });
  }
  function showKitchen(from: "dishes" | "assortment" | "activation") {
    setKitchenReturn(from);
    setCollectionDishId("");
    setBoxCount(1);
    setPage("kitchen");
  }
  function showReview() {
    setActionError("");
    setSectionId("");
    setPage("review");
  }
  function showPreview() {
    setEventDate(eventDate || menu?.startDate || "");
    setPreviewMessage("");
    setPage("preview");
  }
  function recoverDraft({ key, kind, item }: Recovery) {
    if (kind === "menu") {
      menuDraft.recover(
        item as Menu,
        key,
        menus.find((row) => row.id === item.id)?.version,
      );
      setSectionId("");
      setPage("menus");
    } else {
      dishDraft.recover(
        item as Dish,
        key,
        dishes.find((row) => row.id === item.id)?.version,
      );
      setDishBackToSection(false);
      setPage("dishes");
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
    setActionBusy(true);
    setPreviewMessage("");
    try {
      const result = await request(undefined, "?list=catalogue");
      if (!Array.isArray(result.sites) || !Array.isArray(result.items))
        throw new Error("Catalogue is unavailable.");
      setSites(result.sites);
      setCatalogueItems(result.items);
      if (!result.sites.length)
        setPreviewMessage("No sites are available from the catalogue.");
    } catch {
      setPreviewMessage(
        "Hub catalogue is unavailable. Existing mappings are retained; site offerings cannot be checked.",
      );
    } finally {
      setActionBusy(false);
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
      if (!Array.isArray(result.items))
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
      setActionError((failure as Error).message);
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
      !actor.canPublish ||
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
    if (result) {
      setReview(null);
      setActionError(
        "Publication recorded. Review history for the saved revision.",
      );
    }
  }
  async function activateCollection() {
    if (!menu || !actor.canPublish || !activationId || !activationConfirmed)
      return;
    const result = await runAction({
      action: "activate-collection",
      menuId: menu.id,
      publicationId: activationId,
      visibility,
      confirmed: true,
    });
    if (result?.ok) {
      setActivationConfirmed(false);
      setActionError("Activation recorded.");
    }
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
  const dishBack = () =>
    dishBackToSection ? setPage("menus") : dishDraft.open(null);
  const showActivation =
    menu?.kind === "collection"
      ? () => {
          setActionError("");
          setPage("activation");
        }
      : undefined;

  return (
    <StudioShell
      actorName={actor.name}
      page={kitchenCollection ? "activation" : page}
      menuKind={menu?.kind}
      demo={demo}
      navigate={navigate}
    >
      {loading && <p role="status">Loading menus and dishes…</p>}
      {error && (
        <div className="fika-notice fika-notice--danger" role="alert">
          {error} <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}
      {!loading &&
        (createKind ? (
          <MenuWizard
            initialKind={createKind}
            menus={menus}
            close={() => setCreateKind(null)}
            create={newMenu}
          />
        ) : (
          <>
            {page === "home" && (
              <>
                <MenuDashboard
                  actorName={actor.name}
                  menus={menus}
                  dishes={dishes}
                  canManage={actor.canManage}
                  create={() => setCreateKind("seasonal")}
                  openMenu={openMenu}
                  openList={() => navigate("menus")}
                  openDishes={() => navigate("dishes")}
                  openCollections={() => navigate("collections")}
                />
                {recoverable.length > 0 && (
                  <section className={styles.panelBody}>
                    <h2>Unsaved drafts on this device</h2>
                    <p>
                      Choose a retained copy to recover. A newer saved version
                      needs reconciliation.
                    </p>
                    {recoverable.map((copy) => (
                      <button
                        type="button"
                        className={styles.listButton}
                        key={copy.key}
                        onClick={() => recoverDraft(copy)}
                      >
                        <strong>{copy.item.name || "Untitled draft"}</strong>
                        <span>
                          {title(copy.kind)} · Version {copy.item.version} ·
                          Recovery {copy.key.slice(-8)} <Icon name="forward" />
                        </span>
                      </button>
                    ))}
                  </section>
                )}
              </>
            )}
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
                  history={() => {
                    setActionError("");
                    setPage("history");
                  }}
                  activation={showActivation}
                  openSection={openSection}
                  addSection={addSection}
                  update={(values) =>
                    menuDraft.change((item) => ({ ...item, ...values }))
                  }
                />
              </>
            )}
            {page === "menus" && menu && section && (
              <SectionEditor
                key={section.id}
                menu={menu}
                section={section}
                dishes={dishes}
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
                editDish={(item) => openDish(item, true)}
                loadMore={
                  dishCursor ? () => void loadMore("dishes") : undefined
                }
                catalogue={catalogueItems}
                loadCatalogue={() => void loadSites()}
                catalogueNotice={previewMessage}
                openSettings={mappingSectionId === section.id}
                busy={actionBusy}
              />
            )}
            {page === "dishes" && !dish && (
              <DishCollection
                dishes={dishes}
                menus={menus}
                canManage={actor.canManage}
                create={newDish}
                edit={(item) => openDish(item)}
                busy={actionBusy}
                error={actionError}
                loadMore={
                  dishCursor ? () => void loadMore("dishes") : undefined
                }
              />
            )}
            {page === "dishes" && dishProps && (
              <DishEditor
                {...dishProps}
                back={dishBack}
                backLabel={
                  dishBackToSection ? "Section editor" : "Dish collection"
                }
                kitchen={() => showKitchen("dishes")}
                assortment={() => {
                  if (!dish?.assortment)
                    dishDraft.change((item) => ({
                      ...item,
                      assortment: {
                        expectedTotal: 0,
                        unit: "",
                        components: [],
                      },
                    }));
                  setPage("assortment");
                }}
              />
            )}
            {page === "assortment" && dishProps && (
              <AssortmentBuilder
                {...dishProps}
                kitchen={() => showKitchen("assortment")}
                back={() => setPage("dishes")}
              />
            )}
            {page === "preview" && menu && (
              <CustomerPreview
                key={menu.id}
                menu={menu}
                dishes={dishes}
                date={eventDate}
                setDate={setEventDate}
                initialSection={sectionId}
                valid={previewValid}
                saved={menuDraft.state === "saved"}
                busy={actionBusy}
                sites={sites}
                siteId={siteId}
                setSite={setSiteId}
                loadSites={() => void loadSites()}
                checkSite={() => void checkSitePreview()}
                sitePreview={sitePreview}
                notice={previewMessage}
                back={() => setPage("menus")}
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
                dishes={dishes}
                date={effectiveDate}
                setDate={setEffectiveDate}
                scope={reviewScope}
                setSection={(id) =>
                  setReviewScope((previous) => ({
                    ...previous,
                    sectionId: id,
                    week: "",
                  }))
                }
                setWeek={(value) =>
                  setReviewScope((previous) => ({ ...previous, week: value }))
                }
                setDish={(id) =>
                  setReviewScope((previous) => ({ ...previous, dishId: id }))
                }
                result={review}
                busy={actionBusy}
                saved={menuDraft.state === "saved"}
                canPublish={actor.canPublish}
                notice={actionError}
                back={() => setPage("menus")}
                check={() => void checkReview()}
                impact={() => setPage("impact")}
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
              <CollectionActivation
                menu={menu}
                history={history}
                loadHistory={() => void loadHistory("history")}
                revision={activationId}
                setRevision={(id) => {
                  setActivationId(id);
                  setActivationConfirmed(false);
                }}
                visibility={visibility}
                setVisibility={(value) => {
                  setVisibility(value);
                  setActivationConfirmed(false);
                }}
                confirmed={activationConfirmed}
                setConfirmed={setActivationConfirmed}
                canPublish={actor.canPublish}
                busy={actionBusy}
                back={() => setPage("menus")}
                activate={() => void activateCollection()}
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
    </StudioShell>
  );
}
