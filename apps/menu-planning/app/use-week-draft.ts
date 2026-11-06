"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";
import type { PublicationDayState } from "./planner-data";
import { draftStorageKey, editWeek, equal, isWeekDirty, parseRecoveredDraft, reconcileWeek, weekChanges, type DraftConflict, type RecoveredWeekDraft, type WeekSaveRequest } from "@/lib/week-draft";

type DraftState = { base: RollingSnapshot; draft: RollingSnapshot; templateAdditions: string[]; pending?: RecoveredWeekDraft["pending"] };
type Review = { latest: RollingSnapshot; merged: RollingSnapshot; conflicts: DraftConflict[] };
export function useWeekDraft(source: RollingSnapshot | undefined, identity: string, applySaved: (snapshot: RollingSnapshot, publicationState?: Record<string, PublicationDayState>) => void, workingDraftMode = false) {
  const [state, setState] = useState<DraftState>();
  const stateRef = useRef(state);
  const [recovered, setRecovered] = useState<RecoveredWeekDraft>();
  const [review, setReview] = useState<Review>();
  const [latest, setLatest] = useState<RollingSnapshot>();
  const [status, setStatus] = useState<"saved" | "editing" | "saving" | "failed" | "conflict">("saved");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [navigation, setNavigation] = useState<{ href?: string; weekId?: string }>();
  const saving = useRef(false);
  const leaving = useRef(false);
  const scopeRef = useRef("");
  const environment = typeof window === "undefined" ? "" : window.location.origin;
  const key = source && identity ? draftStorageKey(identity, environment, source.week.id) : "";
  const dirty = Boolean(state && (isWeekDirty(state.base, state.draft) || state.pending));
  const protect = useRef(false); protect.current = !leaving.current && (dirty || Boolean(recovered) || saving.current);
  const persist = useCallback((value: DraftState, storageKey = scopeRef.current) => {
    if (!storageKey || !identity) { setStorageError("Draft recovery is unavailable until your identity is verified. Keep this tab open."); return; }
    try {
      if (isWeekDirty(value.base, value.draft) || value.pending) window.localStorage.setItem(storageKey, JSON.stringify({ schema: 1, identity, environment, base: value.base, draft: value.draft, pending: value.pending, templateAdditions: value.templateAdditions, savedAt: Date.now() }));
      else window.localStorage.removeItem(storageKey);
      setStorageError("");
    } catch { setStorageError("This browser could not store the draft. Keep this tab open until Save Week succeeds."); }
  }, [identity, environment]);
  const replace = (value: DraftState) => { stateRef.current = value; setState(value); persist(value); };

  useEffect(() => {
    if (!source || !key) return;
    if (key !== scopeRef.current) {
      leaving.current = false;
      scopeRef.current = key;
      const initial = { base: structuredClone(source), draft: structuredClone(source), templateAdditions: [] };
      stateRef.current = initial; setState(initial); setLatest(undefined); setReview(undefined); setError(""); setStatus("saved");
      try { const stored = parseRecoveredDraft(window.localStorage.getItem(key), identity, environment, source.week.id); setRecovered(stored && (isWeekDirty(stored.base, stored.draft) || stored.pending) ? stored : undefined); }
      catch { setStorageError("Draft recovery is unavailable in this browser."); }
      return;
    }
    const current = stateRef.current;
    if (!current || source.week.version <= current.base.week.version || saving.current) return;
    if (current.pending) { setStatus("failed"); setError("A previous save has an unknown outcome. Retry Save Week to verify it safely before reviewing newer changes."); }
    else if (isWeekDirty(current.base, current.draft)) { setLatest(source); setStatus("conflict"); }
    else { const next = { base: structuredClone(source), draft: structuredClone(source), templateAdditions: [] }; stateRef.current = next; setState(next); }
  }, [source, key, identity, environment]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (protect.current) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      if (!protect.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault(); event.stopImmediatePropagation(); setNavigation({ href: anchor.href });
    };
    const week = (event: Event) => { if (!protect.current) return; event.preventDefault(); event.stopImmediatePropagation(); setNavigation({ weekId: (event as CustomEvent<string>).detail }); };
    let currentUrl = window.location.href;
    const pop = (event: PopStateEvent) => { if (!protect.current) { currentUrl = window.location.href; return; } const target = window.location.href; event.stopImmediatePropagation(); window.history.pushState({}, "", currentUrl); setNavigation({ href: target }); };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true); window.addEventListener("menu-week-select", week, true); window.addEventListener("popstate", pop, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); window.removeEventListener("menu-week-select", week, true); window.removeEventListener("popstate", pop, true); };
  }, [key]);

  const command = async (action: string, input: Record<string, any> = {}) => {
    const current = stateRef.current;
    if (!current || recovered) { setError("Restore or discard the recovered draft before editing."); return false; }
    try {
      const draft = editWeek(current.draft, action, input, { workingDraft: workingDraftMode });
      const added = action === "add-menu-slot" && input.persistence === "template" ? (draft.week.customSlots || []).filter(slot => !current.draft.week.customSlots?.includes(slot)) : [];
      replace({ ...current, draft, templateAdditions: [...current.templateAdditions, ...added].filter(slot => draft.week.customSlots?.includes(slot) && !draft.week.removedSlots?.includes(slot)) });
      if (!saving.current && status !== "conflict") setStatus("editing"); setError(""); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be added to the draft."); return false; }
  };
  const getLatest = async (weekId: string) => {
    const response = await fetch(`/api/rolling-menu?weekId=${encodeURIComponent(weekId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    if (!response.ok || body.snapshot?.week?.id !== weekId) throw Error(body.error?.message || "The latest week could not be loaded.");
    return body.snapshot as RollingSnapshot;
  };
  const save = async () => {
    const current = stateRef.current;
    if (!current || saving.current || recovered || latest || !identity) return false;
    if (!isWeekDirty(current.base, current.draft) && !current.pending) return true;
    const pending = current.pending || { request: { weekId: current.base.week.id, expectedWeekVersion: current.base.week.version, requestId: crypto.randomUUID(), ...(workingDraftMode ? { workingDraft: true } : {}), changes: { ...weekChanges(current.base, current.draft), ...(current.templateAdditions.length ? { templateAdditions: current.templateAdditions } : {}) } } satisfies WeekSaveRequest, submitted: structuredClone(current.draft) };
    saving.current = true; setStatus("saving"); setError(""); replace({ ...current, pending });
    try {
      const response = await fetch("/api/rolling-menu", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ action: "save-week", ...pending.request }) });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          try { setLatest(await getLatest(current.base.week.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "The latest week could not be loaded."); }
          setStatus("conflict");
          // A rejected save has a known outcome, so it can be reconciled under a new request ID.
          replace({ ...stateRef.current!, pending: undefined });
        } else setStatus("failed");
        throw Error(body.error?.message || "Save Week failed. Your draft is retained.");
      }
      const saved = body.snapshot as RollingSnapshot;
      if (saved?.week?.id !== current.base.week.id || saved.week.version < current.base.week.version) throw Error("The save response could not be verified. Retry the same save request.");
      const inFlightDraft = stateRef.current!.draft;
      const rebased = reconcileWeek(pending.submitted, inFlightDraft, saved);
      const next = { base: structuredClone(saved), draft: rebased.merged, templateAdditions: stateRef.current!.templateAdditions.filter(slot => !pending.request.changes.templateAdditions?.includes(slot)) };
      if (rebased.conflicts.length) { replace({ base: pending.submitted, draft: inFlightDraft, templateAdditions: next.templateAdditions }); setLatest(saved); setReview({ latest: saved, ...rebased }); setStatus("conflict"); }
      else { replace(next); setStatus(isWeekDirty(next.base, next.draft) ? "editing" : "saved"); }
      applySaved(saved, body.publicationState);
      return true;
    } catch (cause) { if (stateRef.current?.pending) setStatus("failed"); setError(cause instanceof Error ? cause.message : "Save Week failed. Your full draft is retained."); return false; }
    finally { saving.current = false; }
  };
  const restore = () => {
    if (!recovered || !stateRef.current) return;
    const current = stateRef.current;
    const next = { base: recovered.base, draft: recovered.draft, pending: recovered.pending, templateAdditions: (recovered as RecoveredWeekDraft & { templateAdditions?: string[] }).templateAdditions || [] };
    replace(next); setRecovered(undefined);
    if (recovered.pending) { setLatest(undefined); setStatus("failed"); setError("An interrupted save was recovered. Retry Save Week to verify its outcome using the original request ID."); }
    else if (current.base.week.version !== recovered.base.week.version) { setLatest(current.base); setStatus("conflict"); } else setStatus("editing");
  };
  const discardRecovered = () => { try { window.localStorage.removeItem(key); setRecovered(undefined); } catch { setStorageError("The recovered draft could not be removed."); } };
  const discard = () => { if (saving.current || stateRef.current?.pending) { setError("Retry the interrupted save to establish its outcome before discarding."); return; } if (stateRef.current) { const base = latest || stateRef.current.base; replace({ base, draft: structuredClone(base), templateAdditions: [] }); applySaved(base); } setLatest(undefined); setReview(undefined); setStatus("saved"); setError(""); };
  const reviewLatest = async () => {
    const current = stateRef.current; if (!current || saving.current) return;
    try { const server = latest || await getLatest(current.base.week.id); setLatest(server); setReview({ latest: server, ...reconcileWeek(current.base, current.draft, server) }); } catch (cause) { setError(String(cause)); }
  };
  const resolveConflict = (index: number, choice: "local" | "remote") => {
    if (!review) return;
    const conflict = review.conflicts[index]; const merged = structuredClone(review.merged);
    if (choice === "local") {
      if (conflict.field === "create" || conflict.field === "missing" || (conflict.entryId && !editableDayForReview(review.latest, conflict.entryId))) { setError("This row is occupied, missing or locked. Keep the server value, then place your dish in an editable empty slot. Your original draft remains in browser recovery until review is applied."); return; }
      if (conflict.entryId) Object.assign(merged.entries.find(entry => entry.id === conflict.entryId)!, { [conflict.field]: conflict.local });
      else Object.assign(merged.week, { [conflict.field]: conflict.local });
    }
    setReview({ ...review, merged, conflicts: review.conflicts.filter((_, item) => item !== index) });
  };
  const applyReview = () => { if (!review || review.conflicts.length || !stateRef.current) return; replace({ base: structuredClone(review.latest), draft: review.merged, templateAdditions: stateRef.current.templateAdditions }); applySaved(review.latest); setReview(undefined); setLatest(undefined); setStatus("editing"); setError(""); };
  const leave = (selectWeek: (weekId: string) => void) => { if (!navigation || saving.current) return; const target = navigation; leaving.current = true; setNavigation(undefined); protect.current = false; if (target.weekId) selectWeek(target.weekId); else if (target.href) window.location.assign(target.href); };
  return { snapshot: state?.base.week.id === source?.week.id ? state?.draft : source, dirty, status, error, storageError, recovered, review, latest, navigation, command, save, restore, discardRecovered, discard, reviewLatest, resolveConflict, applyReview, leave, cancelNavigation: () => setNavigation(undefined), setError, saving: saving.current, workingDraftMode };
}
function editableDayForReview(snapshot: RollingSnapshot, entryId: string) { const entry = snapshot.entries.find(entry => entry.id === entryId); return entry && snapshot.week.status !== "published" && snapshot.week.status !== "archived" && snapshot.week.dayStatuses?.[entry.dayId] !== "published"; }
