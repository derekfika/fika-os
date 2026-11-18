"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  calendarDay,
  rotationWeek,
  type StudioActor,
  type Dish,
  type Menu,
  type Review,
  type Publication,
} from "../lib/contract";
import { kitchenQuantities } from "../lib/review";
import styles from "./studio.module.css";
import PublishedKitchenPreview from "./published-kitchen-preview";
import {
  assortmentTotal,
  checkerHandoff,
  dishReviewStatus,
  ReviewResponseGuard,
  type DishReviewStatus,
  localDraftKey as localKey,
  groupSelectedDishes,
  moveGroupedDish,
  planningTarget,
  retainedDraftMatchesRequest,
} from "./studio-model";

type Page =
  | "home"
  | "menus"
  | "dishes"
  | "collections"
  | "history"
  | "preview"
  | "review"
  | "kitchen";
type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Entity = Menu | Dish;

const categories: Dish["category"][] = [
  "meat",
  "fish",
  "vegetarian",
  "vegan",
  "salad",
  "dessert",
  "other",
];
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

async function request(body?: unknown, query = "") {
  const response = await fetch(
    `/api/studio${query}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "The request could not be completed."),
      { status: response.status },
    );
  return result;
}

/** Keeps local edits until a matching server acknowledgement. Writes are serialized. */
function useDraft<T extends Entity>(
  actor: StudioActor,
  kind: "menu" | "dish",
  initial: T | null,
  onSaved: (item: T) => void,
) {
  const [item, setItem] = useState<T | null>(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const current = useRef<T | null>(initial);
  const generation = useRef(0);
  const busy = useRef(false);
  const editor = useRef("");
  if (!editor.current && typeof window !== "undefined")
    editor.current = crypto.randomUUID();
  const recoveredFrom = useRef<{ key: string; value: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const save = useCallback(async () => {
    if (busy.current) {
      timer.current = setTimeout(() => void save(), 800);
      return;
    }
    if (!current.current || !actor.canManage) return;
    busy.current = true;
    const snapshot = structuredClone(current.current);
    const savedGeneration = generation.current;
    setState("saving");
    setError("");
    try {
      const result = await request({ action: `save-${kind}`, item: snapshot });
      const saved = result.item as T;
      if (current.current?.id !== snapshot.id) {
        try {
          const key = localKey(actor.id, kind, snapshot.id, editor.current);
          if (retainedDraftMatchesRequest(localStorage.getItem(key), snapshot))
            localStorage.removeItem(key);
        } catch {
          /* A later recovery remains conservative. */
        }
        onSavedRef.current(saved);
        return;
      }
      if (generation.current === savedGeneration) {
        current.current = saved;
        setItem(saved);
        setState("saved");
        try {
          const key = localKey(actor.id, kind, saved.id, editor.current);
          if (retainedDraftMatchesRequest(localStorage.getItem(key), snapshot))
            localStorage.removeItem(key);
          if (
            recoveredFrom.current &&
            localStorage.getItem(recoveredFrom.current.key) ===
              recoveredFrom.current.value
          )
            localStorage.removeItem(recoveredFrom.current.key);
          recoveredFrom.current = null;
        } catch {
          /* Server acknowledgement remains authoritative. */
        }
      } else if (current.current?.id === saved.id) {
        current.current = {
          ...current.current,
          version: saved.version,
          updatedAt: saved.updatedAt,
        };
        setItem(current.current);
        try {
          localStorage.setItem(
            localKey(actor.id, kind, saved.id, editor.current),
            JSON.stringify(current.current),
          );
        } catch {
          setError(
            "Device storage is unavailable. Keep this page open until your edits are saved.",
          );
        }
        setState("unsaved");
      }
      onSavedRef.current(saved);
    } catch (cause) {
      if (current.current?.id !== snapshot.id) return;
      if (timer.current) clearTimeout(timer.current);
      const failure = cause as Error & { status?: number };
      setState(failure.status === 409 ? "conflict" : "error");
      setError(
        failure.status === 409
          ? "This draft changed elsewhere. Your edits are retained on this device; reopen the current version and reconcile them before saving."
          : `${failure.message} Your edits are retained on this device. Retry when ready.`,
      );
    } finally {
      busy.current = false;
    }
  }, [actor.id, actor.canManage, kind]);
  const open = useCallback(
    (next: T | null) => {
      if (timer.current) clearTimeout(timer.current);
      recoveredFrom.current = null;
      generation.current++;
      if (!next) {
        current.current = null;
        setItem(null);
        setState("saved");
        setError("");
        return;
      }
      let retained: string | null = null;
      try {
        retained = localStorage.getItem(
          localKey(actor.id, kind, next.id, editor.current),
        );
      } catch {
        /* Device storage is unavailable. */
      }
      if (retained) {
        try {
          const parsed = JSON.parse(retained) as T;
          if (parsed.id === next.id) {
            current.current = parsed;
            setItem(parsed);
            setState(parsed.version === next.version ? "unsaved" : "conflict");
            setError(
              parsed.version === next.version
                ? "Unsaved edits were recovered from this device. Review and retry saving."
                : "A newer version exists. Your recovered edits are retained on this device; reconcile them before saving.",
            );
            return;
          }
        } catch {
          /* Keep the stored value intact if it cannot be read. */
        }
      }
      current.current = next;
      setItem(next);
      setState(next.version === 0 ? "unsaved" : "saved");
      setError("");
    },
    [actor.id, kind],
  );
  const change = useCallback(
    (update: (value: T) => T) => {
      if (!current.current || !actor.canManage) return;
      const next = update(structuredClone(current.current));
      current.current = next;
      generation.current++;
      setItem(next);
      try {
        localStorage.setItem(
          localKey(actor.id, kind, next.id, editor.current),
          JSON.stringify(next),
        );
      } catch {
        setError(
          "Device storage is unavailable. Keep this page open until your edits are saved.",
        );
      }
      setState((previous) =>
        previous === "conflict" ? "conflict" : "unsaved",
      );
    },
    [actor.id, actor.canManage, kind],
  );
  useEffect(() => {
    if (state !== "unsaved") return;
    timer.current = setTimeout(() => void save(), 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, item, save]);
  const recover = useCallback(
    (next: T, key: string, serverVersion: number | undefined) => {
      if (timer.current) clearTimeout(timer.current);
      generation.current++;
      let raw: string | null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        setError(
          "Device storage is unavailable. The retained copy could not be opened.",
        );
        return;
      }
      if (!raw) return;
      if (!retainedDraftMatchesRequest(raw, next)) {
        current.current = next;
        setItem(next);
        setState("conflict");
        setError(
          "This retained copy changed on this device. Return home and select it again; both copies remain intact.",
        );
        return;
      }
      recoveredFrom.current = { key, value: raw };
      current.current = next;
      setItem(next);
      try {
        localStorage.setItem(
          localKey(actor.id, kind, next.id, editor.current),
          JSON.stringify(next),
        );
      } catch {
        setError(
          "Device storage is unavailable. Keep this page open until your edits are saved.",
        );
      }
      if (serverVersion !== undefined && serverVersion !== next.version) {
        setState("conflict");
        setError(
          "The saved version changed. Your recovered edits are retained; reconcile them before saving.",
        );
      } else {
        setState("unsaved");
        setError("Recovered edits are ready to save.");
      }
    },
    [actor.id, kind],
  );
  return { item, state, error, open, recover, change, retry: save };
}

function Button({
  children,
  onClick,
  primary,
  disabled,
  label,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  label?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`fika-button ${primary ? "fika-button--primary" : "fika-button--secondary"}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function SaveNotice({
  state,
  error,
  retry,
}: {
  state: SaveState;
  error: string;
  retry: () => void;
}) {
  return (
    <div className={styles.save} role="status" aria-live="polite">
      <span>
        {state === "saved"
          ? "Saved"
          : state === "saving"
            ? "Saving…"
            : state === "unsaved"
              ? "Unsaved changes"
              : state === "conflict"
                ? "Conflict — edits retained"
                : "Save failed — edits retained"}
      </span>
      {error && <p>{error}</p>}
      {state === "error" && <Button onClick={retry}>Retry save</Button>}
    </div>
  );
}

function DishSafetyReview({ dish, saved, canManage }: { dish: Dish; saved: boolean; canManage: boolean }) {
  const key = saved && dish.version > 0 ? `${dish.id}:${dish.version}` : "";
  const current = useRef(new ReviewResponseGuard());
  current.current.select(key);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ key: string; status?: DishReviewStatus; message?: string; url?: string }>({ key: "" });
  useEffect(() => {
    setConfirmed(false);
    setResult({ key: "" });
    return () => { current.current.invalidate(); };
  }, [key]);
  const shown = result.key === key ? result : null;
  async function check() {
    if (!key || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const generation = current.current.start();
    try {
      const response = await request(undefined, `?dishId=${encodeURIComponent(dish.id)}&reviewVersion=${dish.version}`);
      if (current.current.matches(key, generation)) setResult((previous) => ({ key, status: dishReviewStatus(response), url: previous.key === key ? previous.url : undefined }));
    } catch {
      if (current.current.matches(key, generation)) setResult({ key, status: "unavailable", message: "Status could not be checked. Reload the saved dish if it changed elsewhere, then try again." });
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function submit() {
    if (!key || !confirmed || !canManage || busyRef.current || !shown?.status || shown.status === "unavailable") return;
    busyRef.current = true;
    setBusy(true);
    const generation = current.current.start();
    try {
      const response = await request({ action: "submit-dish-review", dishId: dish.id, version: dish.version, confirmed: true });
      if (!current.current.matches(key, generation)) return;
      const handoff = checkerHandoff(response, dish.id, dish.version);
      if (!handoff.acknowledged) throw new Error("Invalid checker handoff");
      setConfirmed(false);
      setResult({ key, message: "Review request acknowledged for this saved version. Check status for current evidence.", url: handoff.url });
    } catch {
      if (current.current.matches(key, generation)) setResult({ key, status: "unavailable", message: "Review could not be requested. The checker may be unavailable or this dish may have changed; reload and try again." });
    } finally { busyRef.current = false; setBusy(false); }
  }
  const labels: Record<DishReviewStatus, string> = { unverified: "Unverified", in_review: "In review", verified: "Verified", revoked: "Revoked", unavailable: "Unavailable" };
  return <section className="fika-card">
    <h2>Food-safety review</h2>
    <p>Review and signing use the existing FIKA allergen checker. The last checked status applies only to the saved dish version and may change; check again for current evidence.</p>
    {!key ? <p>Save the current changes before checking or requesting review.</p> : <>
      <Button disabled={busy} onClick={() => void check()}>{busy ? "Working…" : "Check review status"}</Button>
      <div role="status" aria-live="polite">{shown?.status && <p>Last checked status: {labels[shown.status]} · Version {dish.version}</p>}{shown?.message && <p>{shown.message}</p>}</div>
      {shown?.url && <p><a href={shown.url}>Open the existing allergen checker</a></p>}
      {shown?.status && shown.status !== "unavailable" && canManage && <>
        <label className="fika-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm requesting review of saved version {dish.version}.</label>
        <Button disabled={busy || !confirmed} onClick={() => void submit()}>Request food-safety review</Button>
      </>}
    </>}
  </section>;
}

export default function Studio({ actor }: { actor: StudioActor }) {
  const [page, setPage] = useState<Page>("home");
  const [menus, setMenus] = useState<Menu[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [menuCursor, setMenuCursor] = useState<string | null>(null);
  const [dishCursor, setDishCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [week, setWeek] = useState(0);
  const [filter, setFilter] = useState("all");
  const [temperature, setTemperature] = useState("all");
  const [createKind, setCreateKind] = useState<
    "seasonal" | "collection" | null
  >(null);
  const [baseId, setBaseId] = useState("");
  const [copyWeek, setCopyWeek] = useState("0");
  const [removeSection, setRemoveSection] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [history, setHistory] = useState<Publication[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyMenu, setHistoryMenu] = useState("");
  const historyGuard = useRef(new ReviewResponseGuard());
  const [boxCount, setBoxCount] = useState(1);
  const [draftVersions, setDraftVersions] = useState<
    {
      version: number;
      savedAt: string;
      actorId: string;
      restoredFromVersion?: number;
    }[]
  >([]);
  const [draftVersion, setDraftVersion] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [comparison, setComparison] = useState<string[] | null>(null);
  const comparisonGeneration = useRef(0);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [scopeSection, setScopeSection] = useState("");
  const [scopeWeek, setScopeWeek] = useState("");
  const [scopeDish, setScopeDish] = useState("");
  const [visibility, setVisibility] = useState<"staff" | "customer">("staff");
  const [activationId, setActivationId] = useState("");
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteId, setSiteId] = useState("");
  const [catalogueItems, setCatalogueItems] = useState<
    { id: string; name: string }[]
  >([]);
  const [sitePreview, setSitePreview] = useState<{
    catalogue?: { siteId: string; contentHash: string; scope: string };
    items: {
      id: string;
      name: string;
      dishes: { id: string; name: string; description: string }[];
    }[];
  } | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const reviewGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const [recoverable, setRecoverable] = useState<
    { key: string; kind: "menu" | "dish"; item: Entity }[]
  >([]);
  const menuDraft = useDraft<Menu>(actor, "menu", null, (saved) =>
    setMenus((list) => [saved, ...list.filter((x) => x.id !== saved.id)]),
  );
  const dishDraft = useDraft<Dish>(actor, "dish", null, (saved) =>
    setDishes((list) => [saved, ...list.filter((x) => x.id !== saved.id)]),
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [m, d] = await Promise.all([
        request(undefined, "?list=menus"),
        request(undefined, "?list=dishes"),
      ]);
      setMenus(m.items);
      setDishes(d.items);
      setMenuCursor(m.nextCursor);
      setDishCursor(d.nextCursor);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const found: { key: string; kind: "menu" | "dish"; item: Entity }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        for (const kind of ["menu", "dish"] as const)
          if (key?.startsWith(`fika-studio:${actor.id}:${kind}:`)) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            try {
              const item = JSON.parse(raw) as Entity;
              if (item.id) found.push({ key, kind, item });
            } catch {
              /* Preserve unreadable entries. */
            }
          }
      }
    } catch {
      /* Device storage is unavailable. */
    }
    setRecoverable(found);
  }, [actor.id, page]);
  const menu = menuDraft.item;
  const dish = dishDraft.item;
  historyGuard.current.select(menu?.id || "");
  let kitchen: ReturnType<typeof kitchenQuantities> | null = null;
  if (dish?.assortment) {
    try {
      kitchen = kitchenQuantities(dish, boxCount);
    } catch {
      /* Explain incomplete quantities in the draft preview. */
    }
  }
  const previewDay = calendarDay(eventDate);
  const startDay = menu ? calendarDay(menu.startDate) : NaN;
  const endDay = menu ? calendarDay(menu.endDate) : NaN;
  const anchorDay = menu ? calendarDay(menu.anchorMonday) : NaN;
  const previewValid =
    Number.isFinite(previewDay) &&
    Number.isFinite(startDay) &&
    Number.isFinite(endDay) &&
    previewDay >= startDay &&
    previewDay <= endDay &&
    (!menu?.sections.some((s) => s.mode === "rotation") ||
      (Number.isFinite(anchorDay) && new Date(anchorDay).getUTCDay() === 1));
  useEffect(() => {
    reviewGeneration.current++;
    setReview(null);
  }, [menu, effectiveDate, scopeSection, scopeWeek, scopeDish]);
  useEffect(() => {
    previewGeneration.current++;
    setSitePreview(null);
  }, [menu, eventDate, siteId]);
  useEffect(() => {
    setHistory([]);
    setHistoryCursor(null);
    setHistoryMenu("");
    setActionBusy(false);
    setDraftVersions([]);
    setDraftVersion("");
    setCompareFrom("");
    setCompareTo("");
    setComparison(null);
    comparisonGeneration.current++;
    setRestoreConfirmed(false);
    setActivationId("");
    setActivationConfirmed(false);
  }, [menu?.id]);
  useEffect(() => {
    setRemoveSection(false);
  }, [sectionId]);
  const scope = {
    ...(scopeSection ? { sectionId: scopeSection } : {}),
    ...(scopeWeek ? { week: Number(scopeWeek) } : {}),
    ...(scopeDish ? { dishId: scopeDish } : {}),
  };
  const section = menu?.sections.find((x) => x.id === sectionId);
  const selected = section
    ? section.mode === "static"
      ? section.staticDishIds
      : section.weeks[week] || []
    : [];
  const visibleDishes = dishes.filter(
    (d) =>
      `${d.name} ${d.category}`
        .toLocaleLowerCase("en-GB")
        .includes(search.toLocaleLowerCase("en-GB")) &&
      (filter === "all" ||
        (filter === "veg"
          ? ["vegetarian", "vegan"].includes(d.category)
          : d.category === filter)) &&
      (temperature === "all" || d.temperature === temperature),
  );
  function openMenu(value: Menu) {
    menuDraft.open(value);
    setSectionId("");
    setPage("menus");
  }
  function openDish(value: Dish) {
    dishDraft.open(value);
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
  function newMenu(kind: "seasonal" | "collection") {
    const base = menus.find((x) => x.id === baseId);
    openMenu({
      id: crypto.randomUUID(),
      version: 0,
      name: "",
      kind,
      startDate: "",
      endDate: "",
      anchorMonday: base?.anchorMonday || "",
      sections: base
        ? structuredClone(base.sections).map((s) => ({
            ...s,
            id: crypto.randomUUID(),
          }))
        : [],
      updatedAt: "",
    });
    setCreateKind(null);
    setBaseId("");
  }
  function updateSelected(ids: string[]) {
    menuDraft.change((value) => {
      const s = value.sections.find((x) => x.id === sectionId);
      if (s) {
        if (s.mode === "static") s.staticDishIds = ids;
        else s.weeks[week] = ids;
      }
      return value;
    });
  }
  function navigate(next: Page) {
    setPage(next);
    setSectionId("");
    if (next === "menus" || next === "collections") menuDraft.open(null);
    if (next === "dishes") dishDraft.open(null);
  }
  async function runAction(body: unknown) {
    setActionBusy(true);
    setActionError("");
    try {
      return await request(body);
    } catch (cause) {
      setActionError((cause as Error).message);
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
        "Hub catalogue is unavailable. Existing mappings are retained; eligibility cannot be checked.",
      );
    } finally {
      setActionBusy(false);
    }
  }
  async function checkSitePreview() {
    if (!menu || !siteId || !eventDate) return;
    const generation = previewGeneration.current;
    setActionBusy(true);
    setPreviewMessage("");
    try {
      const result = await request(
        undefined,
        `?menuId=${encodeURIComponent(menu.id)}&eventDate=${encodeURIComponent(eventDate)}&siteId=${encodeURIComponent(siteId)}`,
      );
      if (!Array.isArray(result.items) || !result.catalogue)
        throw new Error("Site eligibility evidence is unavailable.");
      if (generation === previewGeneration.current) setSitePreview(result);
    } catch {
      if (generation === previewGeneration.current) {
        setSitePreview(null);
        setPreviewMessage(
          "Site eligibility could not be checked. Do not treat this draft as customer availability.",
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
        `?list=${list}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (list === "menus") {
        setMenus((values) => [...values, ...result.items]);
        setMenuCursor(result.nextCursor);
      } else {
        setDishes((values) => [...values, ...result.items]);
        setDishCursor(result.nextCursor);
      }
    } catch (cause) {
      setActionError((cause as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function loadHistory(cursor?: string) {
    if (!menu) return;
    const menuId = menu.id;
    const generation = historyGuard.current.start();
    setActionBusy(true);
    setActionError("");
    try {
      const query = new URLSearchParams({ list: "history", menuId });
      if (cursor) query.set("cursor", cursor);
      const result = await request(undefined, `?${query}`);
      if (!Array.isArray(result.items) || !(result.nextCursor === null || typeof result.nextCursor === "string")) throw new Error("Published history is unavailable.");
      if (!historyGuard.current.matches(menuId, generation)) return;
      setHistory((current) => cursor ? [...current, ...result.items] : result.items);
      setHistoryCursor(result.nextCursor);
      setHistoryMenu(menuId);
    } catch (cause) {
      if (historyGuard.current.matches(menuId, generation)) {
        if (!cursor) { setHistory([]); setHistoryCursor(null); setHistoryMenu(""); }
        setActionError((cause as Error).message);
      }
    } finally {
      if (historyGuard.current.matches(menuId, generation)) setActionBusy(false);
    }
  }
  async function loadDraftVersions() {
    if (!menu) return;
    setActionBusy(true);
    setActionError("");
    try {
      const result = await request(
        undefined,
        `?list=versions&menuId=${encodeURIComponent(menu.id)}`,
      );
      if (!Array.isArray(result.items))
        throw new Error("Draft versions are unavailable.");
      setDraftVersions(result.items);
      if (result.nextCursor)
        setActionError("Showing the first page of draft versions.");
    } catch {
      setActionError("Draft versions are unavailable.");
    } finally {
      setActionBusy(false);
    }
  }
  async function compareDraftVersions() {
    if (!menu || !compareFrom || !compareTo) return;
    const generation = ++comparisonGeneration.current;
    setComparison(null);
    setActionError("");
    setActionBusy(true);
    try {
      const result = await request(undefined, `?menuId=${encodeURIComponent(menu.id)}&fromVersion=${encodeURIComponent(compareFrom)}&toVersion=${encodeURIComponent(compareTo)}`);
      if (!Array.isArray(result.changes) || !result.changes.every((change: unknown) => typeof change === "string")) throw new Error("Comparison is unavailable.");
      if (generation === comparisonGeneration.current) setComparison(result.changes);
    } catch {
      if (generation === comparisonGeneration.current) setActionError("Draft comparison is unavailable. Try again.");
    } finally {
      setActionBusy(false);
    }
  }
  function changeComparison(setter: (value: string) => void, value: string) {
    comparisonGeneration.current++;
    setComparison(null);
    setter(value);
  }
  const nav: [Page, string][] = [
    ["home", "Home"],
    ["menus", "Menus"],
    ["dishes", "Dishes"],
    ["collections", "Collections"],
    ["review", "Publish"],
    ["history", "History"],
  ];
  return (
    <div className={`fika-ui ${styles.app}`}>
      <header className={styles.header}>
        <strong>FIKA OS</strong>
        <span>Hospitality Menu Studio</span>
        <span className={styles.actor}>{actor.name}</span>
      </header>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Studio navigation">
          {nav.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={page === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className={styles.main}>
          {loading && <p role="status">Loading menus and dishes…</p>}
          {error && (
            <div className="fika-notice fika-notice--danger" role="alert">
              {error} <Button onClick={() => void load()}>Try again</Button>
            </div>
          )}
          {!loading && (
            <>
              {page === "home" && (
                <>
                  <div className={styles.heading}>
                    <div>
                      <p className={styles.eyebrow}>Hospitality Menu Studio</p>
                      <h1>My menus</h1>
                      <p>Create and prepare company-wide menus.</p>
                    </div>
                    <Button
                      primary
                      disabled={!actor.canManage}
                      onClick={() => setCreateKind("seasonal")}
                    >
                      New menu
                    </Button>
                  </div>
                  <div className={styles.grid}>
                    <section className="fika-card">
                      <h2>Seasonal menus</h2>
                      {menus.filter((x) => x.kind === "seasonal").length ? (
                        menus
                          .filter((x) => x.kind === "seasonal")
                          .map((x) => (
                            <button
                              className={styles.listButton}
                              key={x.id}
                              onClick={() => openMenu(x)}
                            >
                              <strong>{x.name || "Untitled draft"}</strong>
                              <span>
                                {x.startDate || "Dates not set"}{" "}
                                {x.endDate && `– ${x.endDate}`}
                              </span>
                            </button>
                          ))
                      ) : (
                        <p>No seasonal menus yet. Create one to begin.</p>
                      )}
                    </section>
                    <section className="fika-card">
                      <h2>Special collections</h2>
                      <p>
                        Prepare menus for occasions separately from customer
                        availability.
                      </p>
                      <Button onClick={() => navigate("collections")}>
                        View collections
                      </Button>
                    </section>
                    <section className="fika-card">
                      <h2>Dish collection</h2>
                      <p>{dishes.length} dishes loaded</p>
                      <Button onClick={() => navigate("dishes")}>
                        Browse dishes
                      </Button>
                    </section>
                  </div>
                </>
              )}
              {page === "home" && (
                <section className="fika-card">
                  <h2>Published menu</h2>
                  <p>
                    Current published menu status is unavailable until
                    publication history is connected. The menus above are
                    drafts.
                  </p>
                  <h2>Recent draft activity</h2>
                  {[
                    ...menus.map((item) => ({ kind: "Menu", item })),
                    ...dishes.map((item) => ({ kind: "Dish", item })),
                  ]
                    .filter((entry) => entry.item.updatedAt)
                    .sort((a, b) =>
                      b.item.updatedAt.localeCompare(a.item.updatedAt),
                    )
                    .slice(0, 5)
                    .map(({ kind, item }) => (
                      <div className={styles.row} key={`${kind}:${item.id}`}>
                        <span>
                          <strong>{item.name || "Untitled draft"}</strong> ·{" "}
                          {kind}
                        </span>
                        <span>
                          Saved{" "}
                          {new Date(item.updatedAt).toLocaleString("en-GB", {
                            timeZone: "Europe/London",
                          })}
                        </span>
                      </div>
                    ))}
                  {!menus.some((item) => item.updatedAt) &&
                    !dishes.some((item) => item.updatedAt) && (
                      <p>No saved draft activity in the loaded results.</p>
                    )}
                  <p className="fika-help">
                    Activity is based on the currently loaded drafts.
                  </p>
                </section>
              )}
              {page === "home" && recoverable.length > 0 && (
                <section className="fika-card">
                  <h2>Unsaved drafts on this device</h2>
                  <p>
                    Choose a retained copy to recover. Separate editor copies
                    are listed individually; a newer saved version requires
                    reconciliation.
                  </p>
                  {recoverable.map(({ key, kind, item }) => (
                    <button
                      className={styles.listButton}
                      key={key}
                      onClick={() => {
                        if (kind === "menu") {
                          menuDraft.recover(
                            item as Menu,
                            key,
                            menus.find((x) => x.id === item.id)?.version,
                          );
                          setSectionId("");
                          setPage("menus");
                        } else {
                          dishDraft.recover(
                            item as Dish,
                            key,
                            dishes.find((x) => x.id === item.id)?.version,
                          );
                          setPage("dishes");
                        }
                      }}
                    >
                      <strong>{item.name || "Untitled draft"}</strong>
                      <span>
                        {title(kind)} · Version {item.version} · Recovery{" "}
                        {key.slice(-8)} →
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {createKind && (
                <section className="fika-card">
                  <h2>Create a menu</h2>
                  <p>
                    Choose a starting point. Dates and sections can be completed
                    in the draft.
                  </p>
                  <label className="fika-field">
                    Copy an existing menu (optional)
                    <select
                      className="fika-select"
                      value={baseId}
                      onChange={(e) => setBaseId(e.target.value)}
                    >
                      <option value="">Start empty</option>
                      {menus.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || "Untitled draft"}
                        </option>
                      ))}
                    </select>
                    <span className="fika-help">
                      Copies section structure and dish selections into a new
                      draft.
                    </span>
                  </label>
                  <div className={styles.actions}>
                    <Button onClick={() => newMenu("seasonal")}>
                      Seasonal menu
                    </Button>
                    <Button onClick={() => newMenu("collection")}>
                      Special collection
                    </Button>
                    <Button
                      onClick={() => {
                        setCreateKind(null);
                        setBaseId("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </section>
              )}
              {(page === "menus" || page === "collections") && !menu && (
                <>
                  <div className={styles.heading}>
                    <div>
                      <h1>
                        {page === "menus"
                          ? "Seasonal menus"
                          : "Special collections"}
                      </h1>
                      <p>
                        Draft content is separate from customer availability.
                      </p>
                    </div>
                    <Button
                      primary
                      disabled={!actor.canManage}
                      onClick={() =>
                        setCreateKind(
                          page === "menus" ? "seasonal" : "collection",
                        )
                      }
                    >
                      New {page === "menus" ? "menu" : "collection"}
                    </Button>
                  </div>
                  <section className="fika-card">
                    {menus
                      .filter(
                        (x) =>
                          x.kind ===
                          (page === "menus" ? "seasonal" : "collection"),
                      )
                      .map((x) => (
                        <button
                          className={styles.listButton}
                          key={x.id}
                          onClick={() => openMenu(x)}
                        >
                          <strong>{x.name || "Untitled draft"}</strong>
                          <span>{x.startDate || "Dates not set"}</span>
                        </button>
                      ))}
                    {!menus.some(
                      (x) =>
                        x.kind ===
                        (page === "menus" ? "seasonal" : "collection"),
                    ) && <p>No matching menus in the loaded results.</p>}
                    {menuCursor && (
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadMore("menus")}
                      >
                        Load more menus
                      </Button>
                    )}
                    {actionError && <p role="alert">{actionError}</p>}
                  </section>
                </>
              )}
              {page === "menus" && menu && !section && (
                <>
                  {actionError && (
                    <p role="status" className="fika-notice">
                      {actionError}
                    </p>
                  )}
                  <div className={styles.heading}>
                    <div>
                      <button
                        className={styles.back}
                        onClick={() => menuDraft.open(null)}
                      >
                        ← All menus
                      </button>
                      <h1>{menu.name || "New menu"}</h1>
                      <p>
                        {menu.kind === "seasonal"
                          ? "Seasonal menu"
                          : "Special collection"}{" "}
                        · Draft
                      </p>
                    </div>
                    <SaveNotice
                      state={menuDraft.state}
                      error={menuDraft.error}
                      retry={() => void menuDraft.retry()}
                    />
                  </div>
                  <div className={styles.actions}>
                    <Button onClick={() => setPage("preview")}>
                      Customer preview
                    </Button>
                    <Button primary onClick={() => setPage("review")}>
                      Review and publish
                    </Button>
                  </div>
                  <section className="fika-card">
                    <h2>Menu details</h2>
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Name
                        <input
                          className="fika-input"
                          value={menu.name}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => ({
                              ...x,
                              name: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="fika-field">
                        Start date
                        <input
                          type="date"
                          className="fika-input"
                          value={menu.startDate}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => ({
                              ...x,
                              startDate: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="fika-field">
                        End date
                        <input
                          type="date"
                          className="fika-input"
                          value={menu.endDate}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => ({
                              ...x,
                              endDate: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="fika-field">
                        Rotation anchor Monday
                        <input
                          type="date"
                          className="fika-input"
                          value={menu.anchorMonday}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => ({
                              ...x,
                              anchorMonday: e.target.value,
                            }))
                          }
                        />
                        <span className="fika-help">
                          Shared across sites; used for event dates.
                        </span>
                      </label>
                    </div>
                  </section>
                  <section className="fika-card">
                    <div className={styles.heading}>
                      <h2>Menu sections</h2>
                      <Button
                        disabled={!actor.canManage}
                        onClick={() => {
                          const id = crypto.randomUUID();
                          menuDraft.change((x) => ({
                            ...x,
                            sections: [
                              ...x.sections,
                              {
                                id,
                                name: "New section",
                                catalogueItemId: "",
                                mode: "static",
                                staticDishIds: [],
                                weeks: Array.from({ length: 6 }, () => []),
                              },
                            ],
                          }));
                          setSectionId(id);
                        }}
                      >
                        Add section
                      </Button>
                    </div>
                    {menu.sections.map((s) => (
                      <button
                        className={styles.listButton}
                        key={s.id}
                        onClick={() => {
                          setSectionId(s.id);
                          setWeek(0);
                        }}
                      >
                        <strong>{s.name}</strong>
                        <span>
                          {s.mode === "rotation"
                            ? "Six-week rotation"
                            : "All season"}{" "}
                          ·{" "}
                          {s.catalogueItemId
                            ? "Catalogue mapping set"
                            : "Catalogue mapping needed"}{" "}
                          →
                        </span>
                      </button>
                    ))}
                    {!menu.sections.length && (
                      <p>
                        No sections yet. Add a section to start building the
                        menu.
                      </p>
                    )}
                  </section>
                </>
              )}
              {page === "menus" && menu && section && (
                <>
                  <div className={styles.heading}>
                    <div>
                      <button
                        className={styles.back}
                        onClick={() => setSectionId("")}
                      >
                        ← {menu.name || "Menu overview"}
                      </button>
                      <h1>{section.name}</h1>
                      <p>Edit one section at a time.</p>
                      <label className="fika-field">
                        Selected section
                        <select className="fika-select" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setWeek(0); }}>
                          {menu.sections.map((s) => <option key={s.id} value={s.id}>{s.name || "Untitled section"}</option>)}
                        </select>
                      </label>
                    </div>
                    <SaveNotice
                      state={menuDraft.state}
                      error={menuDraft.error}
                      retry={() => void menuDraft.retry()}
                    />
                  </div>
                  <section className="fika-card">
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Section name
                        <input
                          className="fika-input"
                          value={section.name}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => {
                              x.sections.find((s) => s.id === sectionId)!.name =
                                e.target.value;
                              return x;
                            })
                          }
                        />
                      </label>
                      <label className="fika-field">
                        Menu availability
                        <select
                          className="fika-select"
                          value={section.mode}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            menuDraft.change((x) => {
                              x.sections.find((s) => s.id === sectionId)!.mode =
                                e.target.value as "static" | "rotation";
                              return x;
                            })
                          }
                        >
                          <option value="static">All season</option>
                          <option value="rotation">Six-week rotation</option>
                        </select>
                      </label>
                    </div>
                    <label className="fika-choice">
                      <input
                        type="checkbox"
                        checked={removeSection}
                        onChange={(e) => setRemoveSection(e.target.checked)}
                      />{" "}
                      Remove this section and its draft selections
                    </label>
                    <Button
                      disabled={!actor.canManage || !removeSection}
                      onClick={() => {
                        menuDraft.change((x) => ({
                          ...x,
                          sections: x.sections.filter(
                            (s) => s.id !== sectionId,
                          ),
                        }));
                        setSectionId("");
                        setRemoveSection(false);
                      }}
                    >
                      Remove section
                    </Button>
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Hub catalogue item
                        <select
                          className="fika-select"
                          value={section.catalogueItemId}
                          disabled={!actor.canManage || !catalogueItems.length}
                          onChange={(e) =>
                            menuDraft.change((x) => {
                              x.sections.find(
                                (s) => s.id === sectionId,
                              )!.catalogueItemId = e.target.value;
                              return x;
                            })
                          }
                        >
                          <option value="">Not mapped</option>
                          {section.catalogueItemId &&
                            !catalogueItems.some(
                              (item) => item.id === section.catalogueItemId,
                            ) && (
                              <option value={section.catalogueItemId}>
                                Existing mapping: {section.catalogueItemId} (not
                                in loaded catalogue)
                              </option>
                            )}
                          {catalogueItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <span className="fika-help">
                          Mappings use Hub item IDs; Hub controls availability
                          and commercial rules.
                        </span>
                      </label>
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadSites()}
                      >
                        Load Hub catalogue
                      </Button>
                    </div>
                    {previewMessage && <p role="status">{previewMessage}</p>}
                    {section.mode === "rotation" && (
                      <div className={styles.week} aria-label="Rotation week">
                        {Array.from({ length: 6 }, (_, i) => (
                          <button
                            key={i}
                            className="fika-button fika-button--secondary"
                            aria-pressed={week === i}
                            onClick={() => setWeek(i)}
                          >
                            Week {i + 1}
                          </button>
                        ))}
                        <label className="fika-field">
                          Copy from
                          <select
                            className="fika-select"
                            value={copyWeek}
                            onChange={(e) => setCopyWeek(e.target.value)}
                          >
                            {Array.from({ length: 6 }, (_, i) => (
                              <option key={i} value={i}>
                                Week {i + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          disabled={
                            !actor.canManage || Number(copyWeek) === week
                          }
                          onClick={() =>
                            updateSelected([
                              ...(section.weeks[Number(copyWeek)] || []),
                            ])
                          }
                        >
                          Copy into week {week + 1}
                        </Button>
                      </div>
                    )}
                    <h2>
                      {section.mode === "rotation"
                        ? `Week ${week + 1}`
                        : "All season"}{" "}
                      · {selected.length} dishes
                    </h2>
                    {planningTarget(section.name) && (
                      <p className="fika-notice">Planning guide: {planningTarget(section.name)}. These are suggestions, not limits. Veggie / Vegan combines two distinct classifications.</p>
                    )}
                    <p className="fika-help">Dishes are grouped here by classification. Move controls reorder within each group; saved menu order is retained across groups. Load more dishes to resolve selections not yet loaded.</p>
                    {groupSelectedDishes(selected, dishes).map((group) => (
                      <div key={group.label} className={styles.dishGroup}>
                        <h3>{group.label} · {group.ids.length}</h3>
                        {group.ids.map((id, index) => {
                          const item = dishes.find((d) => d.id === id);
                          return (
                            <div className={styles.row} key={id}>
                              <span><strong>{item?.name || "Dish not loaded"}</strong><small>{item ? `${title(item.category)}${item.temperature ? ` · ${title(item.temperature)}` : ""}` : id}</small></span>
                              <div className={styles.actions}>
                                <Button label={`Move ${item?.name || "dish"} up within ${group.label}`} disabled={!actor.canManage || index === 0} onClick={() => updateSelected(moveGroupedDish(selected, group.ids, id, -1))}>Move up</Button>
                                <Button label={`Move ${item?.name || "dish"} down within ${group.label}`} disabled={!actor.canManage || index === group.ids.length - 1} onClick={() => updateSelected(moveGroupedDish(selected, group.ids, id, 1))}>Move down</Button>
                                <Button label={`Remove ${item?.name || "dish"} from section`} disabled={!actor.canManage} onClick={() => updateSelected(selected.filter((x) => x !== id))}>Remove</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {!selected.length && <p>No dishes in this section yet.</p>}
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Find a dish
                        <input
                          className="fika-input"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <label className="fika-field">
                        Category
                        <select
                          className="fika-select"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All categories</option>
                          <option value="veg">Veggie / Vegan</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {title(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fika-field">
                        Temperature
                        <select
                          className="fika-select"
                          value={temperature}
                          onChange={(e) => setTemperature(e.target.value)}
                        >
                          <option value="all">All temperatures</option>
                          <option value="hot">Hot</option>
                          <option value="cold">Cold</option>
                        </select>
                      </label>
                    </div>
                    <div className={styles.rowList}>
                      {visibleDishes
                        .filter((d) => !selected.includes(d.id))
                        .map((d) => (
                          <div className={styles.row} key={d.id}>
                            <span>
                              {d.name || "Untitled dish"} · {title(d.category)}
                            </span>
                            <Button
                              label={`Add ${d.name || "dish"} to section`}
                              disabled={!actor.canManage}
                              onClick={() =>
                                updateSelected([...selected, d.id])
                              }
                            >
                              Add dish
                            </Button>
                          </div>
                        ))}
                    </div>
                    {dishCursor && (
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadMore("dishes")}
                      >
                        Load more dishes
                      </Button>
                    )}
                  </section>
                </>
              )}
              {page === "dishes" && !dish && (
                <>
                  <div className={styles.heading}>
                    <div>
                      <h1>Dish collection</h1>
                      <p>Your reusable Hospitality dishes.</p>
                    </div>
                    <Button
                      primary
                      disabled={!actor.canManage}
                      onClick={newDish}
                    >
                      Add dish
                    </Button>
                  </div>
                  <section className="fika-card">
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Search dishes
                        <input
                          className="fika-input"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <label className="fika-field">
                        Category
                        <select
                          className="fika-select"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All categories</option>
                          <option value="veg">Veggie / Vegan</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {title(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fika-field">
                        Temperature
                        <select
                          className="fika-select"
                          value={temperature}
                          onChange={(e) => setTemperature(e.target.value)}
                        >
                          <option value="all">All temperatures</option>
                          <option value="hot">Hot</option>
                          <option value="cold">Cold</option>
                        </select>
                      </label>
                    </div>
                    {visibleDishes.map((d) => (
                      <button
                        className={styles.listButton}
                        key={d.id}
                        onClick={() => openDish(d)}
                      >
                        <strong>{d.name || "Untitled dish"}</strong>
                        <span>
                          {title(d.category)} ·{" "}
                          {d.temperature
                            ? title(d.temperature)
                            : "Temperature not set"}{" "}
                          · Version {d.version} · Allergen status unavailable →
                        </span>
                      </button>
                    ))}
                    {!visibleDishes.length && (
                      <p>
                        No matching dishes in the loaded results. Change the
                        filters or add a dish.
                      </p>
                    )}
                    {dishCursor && (
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadMore("dishes")}
                      >
                        Load more dishes
                      </Button>
                    )}
                    {actionError && <p role="alert">{actionError}</p>}
                  </section>
                </>
              )}
              {page === "dishes" && dish && (
                <>
                  <div className={styles.heading}>
                    <div>
                      <button
                        className={styles.back}
                        onClick={() => dishDraft.open(null)}
                      >
                        ← Dish collection
                      </button>
                      <h1>{dish.name || "New dish"}</h1>
                      <p>Draft · Version {dish.version}</p>
                    </div>
                    <SaveNotice
                      state={dishDraft.state}
                      error={dishDraft.error}
                      retry={() => void dishDraft.retry()}
                    />
                  </div>
                  <section className="fika-card">
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Dish name
                        <input
                          className="fika-input"
                          value={dish.name}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            dishDraft.change((x) => ({
                              ...x,
                              name: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="fika-field">
                        Category
                        <select
                          className="fika-select"
                          value={dish.category}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            dishDraft.change((x) => ({
                              ...x,
                              category: e.target.value as Dish["category"],
                            }))
                          }
                        >
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {title(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="fika-field">
                        Temperature
                        <select
                          className="fika-select"
                          value={dish.temperature || ""}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            dishDraft.change((x) => ({
                              ...x,
                              temperature: (e.target.value ||
                                null) as Dish["temperature"],
                            }))
                          }
                        >
                          <option value="">Not set</option>
                          <option value="hot">Hot</option>
                          <option value="cold">Cold</option>
                        </select>
                      </label>
                    </div>
                    <div className={styles.formGrid}>
                      <label className="fika-field">
                        Customer description
                        <textarea
                          className="fika-textarea"
                          value={dish.customerDescription}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            dishDraft.change((x) => ({
                              ...x,
                              customerDescription: e.target.value,
                            }))
                          }
                        />
                        <span className="fika-help">
                          Shown in customer-facing menu content.
                        </span>
                      </label>
                      <label className="fika-field">
                        Kitchen-only description
                        <textarea
                          className="fika-textarea"
                          value={dish.kitchenDescription}
                          disabled={!actor.canManage}
                          onChange={(e) =>
                            dishDraft.change((x) => ({
                              ...x,
                              kitchenDescription: e.target.value,
                            }))
                          }
                        />
                        <span className="fika-help">
                          For kitchen specifications, separate from booking
                          notes.
                        </span>
                      </label>
                    </div>
                  </section>
                  <DishSafetyReview dish={dish} saved={dishDraft.state === "saved"} canManage={actor.canManage} />
                  <section className="fika-card">
                    <div className={styles.heading}>
                      <div>
                        <h2>Fixed assortment</h2>
                        <p>
                          Optional per-box breakdown. A draft may be incomplete;
                          totals must match before publication.
                        </p>
                      </div>
                      {!dish.assortment && (
                        <Button
                          disabled={!actor.canManage}
                          onClick={() =>
                            dishDraft.change((x) => ({
                              ...x,
                              assortment: {
                                expectedTotal: 0,
                                unit: "pieces",
                                components: [],
                              },
                            }))
                          }
                        >
                          Add assortment
                        </Button>
                      )}
                    </div>
                    {dish.assortment && (
                      <>
                        <div className={styles.formGrid}>
                          <label className="fika-field">
                            Expected total per box
                            <input
                              type="number"
                              min="0"
                              className="fika-input"
                              value={dish.assortment.expectedTotal}
                              disabled={!actor.canManage}
                              onChange={(e) =>
                                dishDraft.change((x) => {
                                  x.assortment!.expectedTotal = Number(
                                    e.target.value,
                                  );
                                  return x;
                                })
                              }
                            />
                          </label>
                          <label className="fika-field">
                            Unit
                            <input
                              className="fika-input"
                              value={dish.assortment.unit}
                              disabled={!actor.canManage}
                              onChange={(e) =>
                                dishDraft.change((x) => {
                                  x.assortment!.unit = e.target.value;
                                  return x;
                                })
                              }
                            />
                          </label>
                        </div>
                        {dish.assortment.components.map((component, index) => (
                          <div className={styles.row} key={component.id}>
                            <label className="fika-field">
                              Component {index + 1}
                              <input
                                className="fika-input"
                                value={component.name}
                                disabled={!actor.canManage}
                                onChange={(e) =>
                                  dishDraft.change((x) => {
                                    x.assortment!.components[index]!.name =
                                      e.target.value;
                                    return x;
                                  })
                                }
                              />
                            </label>
                            <label className="fika-field">
                              Quantity
                              <input
                                type="number"
                                min="0"
                                className="fika-input"
                                value={component.quantity}
                                disabled={!actor.canManage}
                                onChange={(e) =>
                                  dishDraft.change((x) => {
                                    x.assortment!.components[index]!.quantity =
                                      Number(e.target.value);
                                    return x;
                                  })
                                }
                              />
                            </label>
                            <Button
                              disabled={!actor.canManage}
                              onClick={() =>
                                dishDraft.change((x) => {
                                  x.assortment!.components =
                                    x.assortment!.components.filter(
                                      (c) => c.id !== component.id,
                                    );
                                  return x;
                                })
                              }
                            >
                              Remove component {index + 1}
                            </Button>
                          </div>
                        ))}
                        <p role="status">
                          Total: {assortmentTotal(dish.assortment.components)} /{" "}
                          {dish.assortment.expectedTotal} {dish.assortment.unit}
                          .{" "}
                          {assortmentTotal(dish.assortment.components) ===
                            dish.assortment.expectedTotal &&
                          dish.assortment.expectedTotal > 0
                            ? "Count matches; other publication checks still apply."
                            : "Count does not match."}
                        </p>
                        <div className={styles.actions}>
                          <Button
                            disabled={!actor.canManage}
                            onClick={() =>
                              dishDraft.change((x) => {
                                x.assortment!.components.push({
                                  id: crypto.randomUUID(),
                                  name: "",
                                  quantity: 0,
                                });
                                return x;
                              })
                            }
                          >
                            Add component
                          </Button>
                          <Button
                            disabled={!actor.canManage}
                            onClick={() =>
                              dishDraft.change((x) => ({
                                ...x,
                                assortment: null,
                              }))
                            }
                          >
                            Remove assortment
                          </Button>
                          <Button onClick={() => setPage("kitchen")}>
                            Kitchen preview
                          </Button>
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}
              {page === "preview" && (
                <>
                  <button
                    className={styles.back}
                    onClick={() => setPage("menus")}
                  >
                    ← Menu overview
                  </button>
                  <h1>Draft preview</h1>
                  <p className="fika-notice">
                    This authoring preview is not customer availability. Site
                    eligibility, prices and choice rules require Hub
                    verification and are unavailable here.
                  </p>
                  {menu ? (
                    <section className="fika-card">
                      <label className="fika-field">
                        Event date
                        <input
                          type="date"
                          className="fika-input"
                          value={eventDate}
                          onChange={(e) => setEventDate(e.target.value)}
                        />
                      </label>
                      <div className={styles.actions}>
                        <Button
                          disabled={actionBusy}
                          onClick={() => void loadSites()}
                        >
                          Load sites for eligibility check
                        </Button>
                        {sites.length > 0 && (
                          <label className="fika-field">
                            Site
                            <select
                              className="fika-select"
                              value={siteId}
                              onChange={(e) => setSiteId(e.target.value)}
                            >
                              <option value="">Select a site</option>
                              {sites.map((site) => (
                                <option key={site.id} value={site.id}>
                                  {site.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <Button
                          disabled={
                            actionBusy ||
                            !siteId ||
                            !previewValid ||
                            menuDraft.state !== "saved"
                          }
                          onClick={() => void checkSitePreview()}
                        >
                          Check site eligibility
                        </Button>
                      </div>
                      {previewMessage && <p role="status">{previewMessage}</p>}
                      {sitePreview && (
                        <section className="fika-card">
                          <h2>Site eligibility result</h2>
                          <p>
                            Parent offering visibility checked for this site.
                            Booking rules and final availability remain governed
                            by Hub.
                          </p>
                          {sitePreview.items.length === 0 && (
                            <p>
                              No parent offerings were returned for this site
                              and date.
                            </p>
                          )}
                          {sitePreview.items.map((s) => (
                            <div key={s.id}>
                              <h3>{s.name}</h3>
                              {s.dishes.map((d) => (
                                <p key={d.id}>
                                  <strong>{d.name}</strong> · {d.description}
                                </p>
                              ))}
                            </div>
                          ))}
                        </section>
                      )}
                      <h2>{menu.name || "Untitled menu"} · Draft</h2>
                      {!previewValid && (
                        <p>
                          Select an event date within the menu dates and set a
                          valid Monday rotation anchor where needed.
                        </p>
                      )}
                      {previewValid &&
                        menu.sections.map((s) => {
                          let ids = s.staticDishIds;
                          if (s.mode === "rotation") {
                            try {
                              ids = eventDate
                                ? s.weeks[
                                    rotationWeek(menu.anchorMonday, eventDate) -
                                      1
                                  ] || []
                                : [];
                            } catch {
                              ids = [];
                            }
                          }
                          return (
                            <div key={s.id}>
                              <h3>{s.name}</h3>
                              {s.mode === "rotation" && !eventDate && (
                                <p>
                                  Select an event date to preview its rotation
                                  week.
                                </p>
                              )}
                              {ids.map((id) => {
                                const d = dishes.find((x) => x.id === id);
                                return d ? (
                                  <div className={styles.row} key={id}>
                                    <span>
                                      <strong>{d.name}</strong>
                                      <br />
                                      {d.customerDescription}
                                    </span>
                                  </div>
                                ) : (
                                  <p key={id}>
                                    Dish content unavailable or not yet loaded.
                                  </p>
                                );
                              })}
                            </div>
                          );
                        })}
                    </section>
                  ) : (
                    <p>Select a menu first.</p>
                  )}
                </>
              )}
              {page === "review" && (
                <>
                  <button
                    className={styles.back}
                    onClick={() => setPage("menus")}
                  >
                    ← Menu overview
                  </button>
                  <h1>Review changes and publish</h1>
                  {!menu ? (
                    <p>Select a menu first.</p>
                  ) : (
                    <section className="fika-card">
                      <p>
                        Publication requires a saved draft, current safety
                        evidence and an explicit confirmation. Existing bookings
                        are not changed.
                      </p>
                      <label className="fika-field">
                        Effective date
                        <input
                          type="date"
                          className="fika-input"
                          value={effectiveDate}
                          onChange={(e) => {
                            setEffectiveDate(e.target.value);
                            setReview(null);
                          }}
                        />
                        <span className="fika-help">
                          Use today for an immediate publication or choose a
                          future date.
                        </span>
                      </label>
                      <div className={styles.formGrid}>
                        <label className="fika-field">
                          Section scope
                          <select
                            className="fika-select"
                            value={scopeSection}
                            onChange={(e) => {
                              setScopeSection(e.target.value);
                              setScopeWeek("");
                            }}
                          >
                            <option value="">Entire menu</option>
                            {menu.sections.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {scopeSection && (
                          <label className="fika-field">
                            Week scope
                            <select
                              className="fika-select"
                              value={scopeWeek}
                              onChange={(e) => setScopeWeek(e.target.value)}
                            >
                              <option value="">All weeks</option>
                              {menu.sections.find((s) => s.id === scopeSection)
                                ?.mode === "rotation" &&
                                Array.from({ length: 6 }, (_, i) => (
                                  <option key={i} value={i + 1}>
                                    Week {i + 1}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        <label className="fika-field">
                          Dish scope
                          <select
                            className="fika-select"
                            value={scopeDish}
                            onChange={(e) => setScopeDish(e.target.value)}
                          >
                            <option value="">All dishes</option>
                            {dishes.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <Button
                        disabled={
                          actionBusy ||
                          menuDraft.state !== "saved" ||
                          !effectiveDate
                        }
                        onClick={() =>
                          void (async () => {
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
                          })()
                        }
                      >
                        {actionBusy ? "Checking…" : "Check changes and impact"}
                      </Button>
                      {review && (
                        <>
                          <h2>Selected scope</h2>
                          <p>
                            A detailed comparison with the published revision is
                            not yet available.
                          </p>
                          {review.changes.length ? (
                            <ul>
                              {review.changes.map((x, i) => (
                                <li key={i}>{x}</li>
                              ))}
                            </ul>
                          ) : (
                            <p>No scope details reported.</p>
                          )}
                          <h2>Food safety</h2>
                          <p>
                            {review.safety.status === "verified"
                              ? "Verified by the existing safety process"
                              : `Safety evidence ${review.safety.status}; publication is blocked.`}
                          </p>
                          <h2>Future booking impact</h2>
                          {review.impact.status === "unavailable" ? (
                            <p>
                              Impact is unavailable. The number of affected
                              bookings is unknown.
                            </p>
                          ) : review.impact.bookings.length ? (
                            <ul>
                              {review.impact.bookings.map((b) => (
                                <li key={b.id}>
                                  {b.id} · {b.eventDate} · {b.site} ·{" "}
                                  {b.selections.join(", ")}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>
                              No affected bookings reported by the impact check.
                            </p>
                          )}
                          <p>
                            Existing bookings keep their original specifications
                            and will not be amended or resent.
                          </p>
                          {review.issues.length > 0 && (
                            <ul>
                              {review.issues.map((x, i) => (
                                <li key={i}>{x}</li>
                              ))}
                            </ul>
                          )}
                          <Button
                            primary
                            disabled={
                              actionBusy ||
                              !review.canPublish ||
                              review.safety.status !== "verified" ||
                              !review.reviewToken ||
                              !actor.canPublish ||
                              menuDraft.state !== "saved"
                            }
                            onClick={() =>
                              void (async () => {
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
                              })()
                            }
                          >
                            {actionBusy ? "Publishing…" : "Confirm and publish"}
                          </Button>
                        </>
                      )}
                      {actionError && <p role="status">{actionError}</p>}
                    </section>
                  )}
                </>
              )}
              {page === "history" && (
                <>
                  <h1>Versions and history</h1>
                  {menu ? (
                    <section className="fika-card">
                      <p>
                        History for {menu.name}. Restoring creates a new draft
                        and does not change existing bookings.
                      </p>
                      <h2>Draft versions</h2>
                      <p>
                        Restore a saved draft as a new version. Current draft
                        content will be superseded; published history and
                        existing bookings remain unchanged.
                      </p>
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadDraftVersions()}
                      >
                        Load draft versions
                      </Button>
                      {draftVersions.length > 0 && (
                        <>
                          <ul aria-label="Saved draft history">
                            {draftVersions.map((v) => <li key={v.version}>Version {v.version} · {v.savedAt} · Saved by {v.actorId}{v.restoredFromVersion !== undefined ? ` · Restored from version ${v.restoredFromVersion}` : ""}</li>)}
                          </ul>
                          <h3>Compare saved drafts</h3>
                          <p>Compare saved menu structure. This is not a published revision comparison and does not include changes to independently saved dish details.</p>
                          <div className={styles.formGrid}>
                            <label className="fika-field">From version
                              <select className="fika-select" value={compareFrom} onChange={(e) => changeComparison(setCompareFrom, e.target.value)}>
                                <option value="">Select a version</option>
                                {draftVersions.map((v) => <option key={v.version} value={v.version}>Version {v.version} · {v.savedAt}</option>)}
                              </select>
                            </label>
                            <label className="fika-field">To version
                              <select className="fika-select" value={compareTo} onChange={(e) => changeComparison(setCompareTo, e.target.value)}>
                                <option value="">Select a version</option>
                                {draftVersions.map((v) => <option key={v.version} value={v.version}>Version {v.version} · {v.savedAt}</option>)}
                              </select>
                            </label>
                          </div>
                          <Button disabled={actionBusy || !compareFrom || !compareTo} onClick={() => void compareDraftVersions()}>Compare saved drafts</Button>
                          {comparison && <div role="status"><h3>Version {compareFrom} to {compareTo}</h3>{comparison.length ? <ul>{comparison.map((change, i) => <li key={i}>{change}</li>)}</ul> : <p>No structural differences found.</p>}</div>}
                          <h3>Restore a draft</h3>
                          <label className="fika-field">
                            Saved draft version
                            <select
                              className="fika-select"
                              value={draftVersion}
                              onChange={(e) => {
                                setDraftVersion(e.target.value);
                                setRestoreConfirmed(false);
                              }}
                            >
                              <option value="">Select a version</option>
                              {draftVersions.map((v) => (
                                <option
                                  key={v.version}
                                  value={v.version}
                                  disabled={v.version === menu.version}
                                >
                                  Version {v.version} · {v.savedAt}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="fika-choice">
                            <input
                              type="checkbox"
                              checked={restoreConfirmed}
                              onChange={(e) =>
                                setRestoreConfirmed(e.target.checked)
                              }
                            />{" "}
                            I confirm replacing the current draft with this
                            version as a new draft.
                          </label>
                          <Button
                            disabled={
                              !actor.canManage ||
                              !draftVersion ||
                              !restoreConfirmed ||
                              actionBusy ||
                              menuDraft.state !== "saved"
                            }
                            onClick={() =>
                              void (async () => {
                                const result = await runAction({
                                  action: "restore-draft",
                                  menuId: menu.id,
                                  version: menu.version,
                                  sourceVersion: Number(draftVersion),
                                  confirmed: true,
                                });
                                if (result) {
                                  menuDraft.open(result.item);
                                  setRestoreConfirmed(false);
                                  setActionError(
                                    typeof result.restoredVersion ===
                                      "number" &&
                                      result.item.version >
                                        result.restoredVersion
                                      ? `Restore was acknowledged as version ${result.restoredVersion}; the latest draft is now version ${result.item.version}.`
                                      : "Draft restored as a new version.",
                                  );
                                  setPage("menus");
                                }
                              })()
                            }
                          >
                            Restore draft version
                          </Button>
                        </>
                      )}
                      <h2>Published versions</h2>
                      <Button
                        disabled={actionBusy}
                        onClick={() => void loadHistory()}
                      >
                        Load published history
                      </Button>
                      {historyMenu === menu.id && history.map((p) => (
                        <div className={styles.row} key={p.id}>
                          <span>
                            Revision {p.revision} · Effective {p.effectiveDate}{" "}
                            · Published {p.publishedAt}
                          </span>
                          <Button
                            disabled={
                              actionBusy ||
                              !actor.canManage ||
                              menuDraft.state !== "saved"
                            }
                            onClick={() =>
                              void (async () => {
                                const result = await runAction({
                                  action: "restore-menu",
                                  menuId: menu.id,
                                  version: menu.version,
                                  publicationId: p.id,
                                });
                                if (result) {
                                  menuDraft.open(result.item);
                                  setPage("menus");
                                }
                              })()
                            }
                          >
                            Restore as new draft
                          </Button>
                        </div>
                      ))}
                      {historyMenu === menu.id && history.length === 0 && <p>No published versions are recorded for this menu.</p>}
                      {historyMenu === menu.id && historyCursor && <Button disabled={actionBusy} onClick={() => void loadHistory(historyCursor)}>Load more published versions</Button>}
                      <PublishedKitchenPreview key={menu.id} menuId={menu.id} publications={historyMenu === menu.id ? history : []} historyLoaded={historyMenu === menu.id} />
                      {menu.kind === "collection" && (
                        <>
                          <h2>Collection activation</h2>
                          <p>
                            Publishing content does not make a collection
                            bookable. Customer availability requires separate
                            Hub commercial approval.
                          </p>
                          <label className="fika-field">
                            Published revision
                            <select
                              className="fika-select"
                              value={activationId}
                              onChange={(e) => {
                                setActivationId(e.target.value);
                                setActivationConfirmed(false);
                              }}
                            >
                              <option value="">Select a revision</option>
                              {history.map((p) => (
                                <option key={p.id} value={p.id}>
                                  Revision {p.revision} · {p.effectiveDate}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="fika-field">
                            Visibility
                            <select
                              className="fika-select"
                              value={visibility}
                              onChange={(e) => {
                                setVisibility(
                                  e.target.value as "staff" | "customer",
                                );
                                setActivationConfirmed(false);
                              }}
                            >
                              <option value="staff">Staff only</option>
                              <option value="customer">Customer-facing</option>
                            </select>
                          </label>
                          <label className="fika-choice">
                            <input
                              type="checkbox"
                              checked={activationConfirmed}
                              onChange={(e) =>
                                setActivationConfirmed(e.target.checked)
                              }
                            />{" "}
                            I confirm this separate activation request.
                          </label>
                          <Button
                            primary
                            disabled={
                              !actor.canPublish ||
                              !activationId ||
                              !activationConfirmed ||
                              actionBusy
                            }
                            onClick={() =>
                              void (async () => {
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
                              })()
                            }
                          >
                            {actionBusy ? "Activating…" : "Activate collection"}
                          </Button>
                        </>
                      )}
                      {actionError && <p role="status">{actionError}</p>}
                    </section>
                  ) : (
                    <p>Select a menu before opening its history.</p>
                  )}
                </>
              )}
              {page === "kitchen" && (
                <>
                  <button
                    className={styles.back}
                    onClick={() => setPage("dishes")}
                  >
                    ← Dish editor
                  </button>
                  <h1>Draft kitchen preview</h1>
                  <p className="fika-notice">
                    This is a draft specification, not a verified production
                    packet or a booking instruction.
                  </p>
                  {dish && (
                    <section className="fika-card">
                      <h2>{dish.name}</h2>
                      <p>
                        {dish.kitchenDescription ||
                          "No kitchen description entered."}
                      </p>
                      {dish.assortment && (
                        <>
                          <label className="fika-field">
                            Number of boxes
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="fika-input"
                              value={boxCount}
                              onChange={(e) =>
                                setBoxCount(Number(e.target.value))
                              }
                            />
                          </label>
                          {kitchen ? (
                            <>
                              <p>
                                {kitchen.boxes} boxes × {kitchen.perBox}{" "}
                                {kitchen.unit} per box = {kitchen.total}{" "}
                                {kitchen.unit}
                              </p>
                              {kitchen.components.map((c) => (
                                <p key={c.id}>
                                  {c.name}: {c.perBox} per box · {c.total} total
                                </p>
                              ))}
                            </>
                          ) : (
                            <p role="status">
                              Enter a whole positive box count and complete the
                              assortment before calculating totals.
                            </p>
                          )}
                        </>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
