"use client";

import { useEffect, useRef, useState } from "react";
import type { Dish } from "../lib/contract";
import { Button } from "./studio-ui";
import { checkerLink, dishSafetyStatus, safetyLabels, type DishSafetyStatus } from "./studio-dish-safety-model";
import { request } from "./use-studio-draft";
import styles from "./studio.module.css";

export function DishSafety({ dish, saved, canManage, checkerOrigin }: {
  dish: Dish;
  saved: boolean;
  canManage: boolean;
  checkerOrigin?: string;
}) {
  const [status, setStatus] = useState<DishSafetyStatus>("unavailable");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string>();
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);

  async function refresh() {
    if (!saved || !dish.version) return;
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ dishId: dish.id, reviewVersion: String(dish.version) });
      const result = await request(undefined, `?${query}`);
      if (mounted.current && current === sequence.current) setStatus(dishSafetyStatus(result?.status));
    } catch {
      if (mounted.current && current === sequence.current) setStatus("unavailable");
    } finally {
      if (mounted.current && current === sequence.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; sequence.current++; };
    // The parent remounts this component whenever the dish, version or save state changes.
  }, []);

  async function submit() {
    if (!saved || !dish.version || !canManage || !checkerOrigin || busy) return;
    const current = ++sequence.current;
    setBusy(true);
    setError("");
    setLink(undefined);
    try {
      const result = await request({ action: "submit-dish-review", dishId: dish.id, version: dish.version, confirmed: true });
      const nextLink = checkerLink(checkerOrigin, result?.subject, dish.id, dish.version);
      if (!nextLink) throw new Error("The review could not be opened. Try again.");
      if (mounted.current && current === sequence.current) {
        setLink(nextLink);
        setStatus("unavailable");
      }
      const query = new URLSearchParams({ dishId: dish.id, reviewVersion: String(dish.version) });
      const state = await request(undefined, `?${query}`);
      if (mounted.current && current === sequence.current) setStatus(dishSafetyStatus(state?.status));
    } catch (failure) {
      if (mounted.current && current === sequence.current) {
        setStatus("unavailable");
        setError(failure instanceof Error ? failure.message : "The review could not be requested.");
      }
    } finally {
      if (mounted.current && current === sequence.current) setBusy(false);
    }
  }

  return (
    <section className="fika-notice" aria-label="Food safety">
      <h2>Food safety</h2>
      <p role="status">{!saved || !dish.version ? "Save this dish to check its food-safety status." : busy ? "Checking food-safety status…" : safetyLabels[status]}</p>
      {saved && dish.version > 0 && <p>Last checked for saved version {dish.version}. Recheck after food-safety review.</p>}
      {!checkerOrigin && <p>The CPU checker is unavailable in this environment.</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button onClick={() => void refresh()} disabled={!saved || !dish.version || busy}>Recheck status</Button>
        <Button onClick={() => void submit()} disabled={!saved || !dish.version || !canManage || !checkerOrigin || busy}>Request food-safety review</Button>
        {link && <a className="fika-button fika-button--secondary" href={link}>Open CPU allergen checker</a>}
      </div>
    </section>
  );
}
