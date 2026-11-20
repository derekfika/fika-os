import { useCallback, useEffect, useRef, useState } from "react";
import type { Dish, Menu, StudioActor } from "../lib/contract";
import {
  canApplyDraftResponse,
  localDraftKey as localKey,
  retainedCopyKey,
  retainedDraftMatchesRequest,
  retainedMetadataKey,
  retainedTimestamp,
} from "./studio-model";
import type { SaveState } from "./studio-ui";

type Entity = Menu | Dish;

export async function request(body?: unknown, query = "") {
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
export function useDraft<T extends Entity>(
  actor: StudioActor,
  kind: "menu" | "dish",
  initial: T | null,
  onSaved: (item: T) => void,
) {
  const [item, setItem] = useState<T | null>(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [retainedAt, setRetainedAt] = useState<string | null>(null);
  const current = useRef<T | null>(initial);
  const generation = useRef(0);
  const context = useRef(0);
  const busy = useRef(false);
  const editor = useRef("");
  if (!editor.current && typeof window !== "undefined")
    editor.current = crypto.randomUUID();
  const preservation = useRef<{ key: string; value: string } | null>(null);
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
    const savedContext = context.current;
    const savedEditor = editor.current;
    setState("saving");
    setError("");
    try {
      const result = await request({ action: `save-${kind}`, item: snapshot });
      const saved = result.item as T;
      if (
        !canApplyDraftResponse(
          savedContext,
          context.current,
          snapshot.id,
          current.current?.id,
        )
      ) {
        try {
          const key = localKey(actor.id, kind, snapshot.id, savedEditor);
          if (
            recoveredFrom.current?.key !== key &&
            retainedDraftMatchesRequest(localStorage.getItem(key), snapshot)
          )
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
          const key = localKey(actor.id, kind, saved.id, savedEditor);
          if (retainedDraftMatchesRequest(localStorage.getItem(key), snapshot))
            localStorage.removeItem(key);
          if (
            recoveredFrom.current &&
            retainedDraftMatchesRequest(
              recoveredFrom.current.value,
              snapshot,
            ) &&
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
      if (
        !canApplyDraftResponse(
          savedContext,
          context.current,
          snapshot.id,
          current.current?.id,
        )
      )
        return;
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
      setRetainedAt(null);
      context.current++;
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
      setRetainedAt(null);
      try {
        const key = localKey(actor.id, kind, next.id, editor.current);
        const value = JSON.stringify(next);
        localStorage.setItem(key, value);
        const at = new Date().toISOString();
        localStorage.setItem(
          retainedMetadataKey(key),
          JSON.stringify({ value, at }),
        );
        setRetainedAt(at);
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
      if (timer.current) clearTimeout(timer.current);
      context.current++;
      generation.current++;
      setRetainedAt(null);
      recoveredFrom.current = { key, value: raw };
      // New edits use an independent key, even if the selected copy changed.
      editor.current = crypto.randomUUID();
      if (!retainedDraftMatchesRequest(raw, next)) {
        current.current = next;
        setItem(next);
        setState("conflict");
        setError(
          "This retained copy changed on this device. Return home and select it again; both copies remain intact.",
        );
        return;
      }
      try {
        setRetainedAt(
          retainedTimestamp(
            raw,
            localStorage.getItem(retainedMetadataKey(key)),
          ),
        );
      } catch {
        setRetainedAt(null);
      }
      current.current = next;
      setItem(next);
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
  const openLatest = useCallback(async () => {
    const retained = current.current;
    if (!retained) return;
    const retainedContext = context.current;
    try {
      // Reuse an exact retained copy across retries; never replace a different payload.
      const raw = JSON.stringify(retained);
      const editorKey = localKey(actor.id, kind, retained.id, editor.current);
      let key = retainedCopyKey(
        raw,
        recoveredFrom.current,
        preservation.current,
        editorKey,
        (candidate) => localStorage.getItem(candidate),
      );
      let existing = localStorage.getItem(key);
      if (existing !== null && existing !== raw) {
        key = localKey(actor.id, kind, retained.id, crypto.randomUUID());
        existing = null;
      }
      if (existing === null) localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw)
        throw new Error("Storage unavailable");
      preservation.current = { key, value: raw };
      try {
        if (retainedAt && key !== recoveredFrom.current?.key)
          localStorage.setItem(
            retainedMetadataKey(key),
            JSON.stringify({ value: raw, at: retainedAt }),
          );
      } catch {
        /* Timing metadata is optional. */
      }
      const query = new URLSearchParams({
        [kind === "menu" ? "menuId" : "dishId"]: retained.id,
      });
      const result = await request(undefined, `?${query}`);
      if (context.current !== retainedContext || current.current !== retained)
        return;
      if (
        !result.item ||
        result.item.id !== retained.id ||
        !Number.isInteger(result.item.version) ||
        result.item.version < 1
      )
        throw new Error("Invalid saved draft");
      // A new editor key prevents subsequent edits from replacing the retained copy.
      editor.current = crypto.randomUUID();
      preservation.current = null;
      recoveredFrom.current = null;
      context.current++;
      generation.current++;
      current.current = result.item as T;
      setItem(current.current);
      setState("saved");
      setError("");
      setRetainedAt(null);
      onSavedRef.current(current.current);
    } catch {
      if (context.current !== retainedContext || current.current !== retained)
        return;
      setError(
        "The latest saved draft could not be opened. Your edits are still here; try again.",
      );
    }
  }, [actor.id, kind, retainedAt]);
  return {
    item,
    state,
    error,
    open,
    recover,
    change,
    retry: save,
    openLatest,
    retainedAt,
  };
}
