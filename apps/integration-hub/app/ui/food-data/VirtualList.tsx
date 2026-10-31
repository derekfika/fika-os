"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./food-data.module.css";

const ROW_HEIGHT = 52;
const OVERSCAN = 6;

/** Windowed list (the parent re-keys it when the result set changes, which resets the scroll position): only the rows in view (plus a small overscan) exist in the DOM, however long the list is. */
export default function VirtualList({ count, label, activeIndex, renderRow, onActivate }: { count: number; label: string; activeIndex?: number; renderRow: (index: number, props: { className: string; "aria-current": boolean; "data-index": number; onClick: () => void }) => ReactNode; onActivate: (index: number) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(560);
  const pendingFocus = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const measure = () => setHeight(element.clientHeight || 560);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(count - 1, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible: ReactNode[] = [];
  for (let index = first; index <= last; index++) visible.push(<div key={index} role="listitem" className={styles.rowSlot} style={{ top: index * ROW_HEIGHT }}>{renderRow(index, { className: styles.row, "aria-current": index === activeIndex, "data-index": index, onClick: () => onActivate(index) })}</div>);

  useEffect(() => {
    if (pendingFocus.current === undefined) return;
    const target = viewport.current?.querySelector<HTMLElement>(`[data-index="${pendingFocus.current}"]`);
    if (target) { target.focus(); pendingFocus.current = undefined; }
  });
  const move = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.index);
    if (Number.isNaN(current)) return;
    const next = event.key === "ArrowDown" ? current + 1 : event.key === "ArrowUp" ? current - 1 : event.key === "PageDown" ? current + 8 : event.key === "PageUp" ? current - 8 : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const bounded = Math.min(count - 1, Math.max(0, next)); pendingFocus.current = bounded;
    const element = viewport.current!;
    if (bounded * ROW_HEIGHT < element.scrollTop) element.scrollTop = bounded * ROW_HEIGHT;
    else if ((bounded + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = (bounded + 1) * ROW_HEIGHT - element.clientHeight;
    setScrollTop(element.scrollTop);
    const target = element.querySelector<HTMLElement>(`[data-index="${bounded}"]`); if (target) { target.focus(); pendingFocus.current = undefined; }
  }, [count]);

  return <div ref={viewport} className={styles.viewport} role="list" aria-label={label} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={move}>
    <div style={{ height: count * ROW_HEIGHT, position: "relative" }}>{visible}</div>
  </div>;
}
