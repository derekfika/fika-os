"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./planner-cell-menu.css";
import { nextMenuIndex, placeMenu, type CellMenuAction, type CellMenuActionId } from "@/lib/planner-cell-menu";

type Props = {
  /** Where the menu opens: the pointer, or the focused cell for the keyboard. */
  anchor: { x: number; y: number };
  label: string;
  actions: readonly CellMenuAction[];
  onSelect: (id: CellMenuActionId) => void;
  /** Close without acting. The planner returns focus to the cell. */
  onClose: () => void;
};

const ICONS: Record<CellMenuActionId, string> = {
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  change: "M7 7h11l-3-3M17 17H6l3 3",
  copy: "M8 8h11v11H8zM5 16V5h11",
  clear: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  select: "M12 5v14M5 12h14",
};

/**
 * A small ARIA menu for one planner cell. It only reports which action was chosen; nothing is
 * written until the planner handles an explicit click, Enter or Space. Escape, clicking elsewhere and
 * scrolling close it without acting.
 */
export default function PlannerCellMenu({ anchor, label, actions, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState(anchor);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition(placeMenu(anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor, actions.length]);

  useEffect(() => {
    itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const closeOnScroll = () => onClose();
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    window.addEventListener("blur", closeOnScroll);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
      window.removeEventListener("blur", closeOnScroll);
    };
  }, [onClose]);

  const run = (action: CellMenuAction) => {
    if (action.disabledReason) return;
    onSelect(action.id);
  };

  return (
    <div
      ref={menuRef}
      className="planner-cell-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (event.key === "Tab") { event.preventDefault(); onClose(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setActive((current) => nextMenuIndex(current, event.key, actions.length));
        }
      }}
    >
      {actions.map((action, index) => (
        <div key={action.id} role="none">
          {action.dividerBefore && <hr className="planner-cell-menu__divider" role="separator" />}
          <button
            ref={(element) => { itemRefs.current[index] = element; }}
            type="button"
            role="menuitem"
            tabIndex={index === active ? 0 : -1}
            aria-disabled={action.disabledReason ? true : undefined}
            aria-describedby={action.disabledReason ? `${action.id}-reason` : undefined}
            className={`planner-cell-menu__item${action.destructive ? " planner-cell-menu__item--danger" : ""}${action.disabledReason ? " planner-cell-menu__item--disabled" : ""}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => run(action)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICONS[action.id]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{action.label}</span>
          </button>
          {action.disabledReason && <span id={`${action.id}-reason`} className="planner-cell-menu__reason">{action.disabledReason}</span>}
        </div>
      ))}
    </div>
  );
}
