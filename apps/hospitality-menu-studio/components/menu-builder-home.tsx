"use client";

import { useMemo, useRef, useState } from "react";
import type { CatalogueRow } from "./catalogue-wire";
import type { ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";
import { StudioButton, StudioField, StudioPageHeader, StudioStatus } from "./studio-design-system";
import styles from "./menu-builder-home.module.css";

export type { ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";

export type ProductMenuSetup = { kind: "fixed" } | { kind: "rotation"; anchorMonday: string; cycleWeeks: number };

export function MenuBuilderHome({
  products,
  summaries,
  canManage = true,
  onOpen,
  onCreate,
}: {
  products: CatalogueRow[];
  summaries: ProductMenuSummary[];
  canManage?: boolean;
  onOpen: (itemId: string) => void;
  onCreate: (itemId: string, setup: ProductMenuSetup) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "configured" | "not-configured">("all");
  const [selected, setSelected] = useState<CatalogueRow | null>(null);
  const [kind, setKind] = useState<"fixed" | "rotation">("fixed");
  const [weeks, setWeeks] = useState("4");
  const [anchorMonday, setAnchorMonday] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const configured = useMemo(() => new Map(summaries.map((item) => [item.itemId, item])), [summaries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    return products.filter((item) => {
      const hasMenu = configured.has(item.itemId);
      if (filter === "configured" && !hasMenu) return false;
      if (filter === "not-configured" && hasMenu) return false;
      return !needle || `${item.name} ${item.category}`.toLocaleLowerCase("en-GB").includes(needle);
    });
  }, [configured, filter, products, query]);

  function startCreate(product: CatalogueRow) {
    setSelected(product);
    setKind("fixed");
    setWeeks("4");
    setAnchorMonday("");
    setError("");
    dialog.current?.showModal();
  }

  async function create() {
    if (!selected || creating) return;
    let setup: ProductMenuSetup = { kind: "fixed" };
    if (kind === "rotation") {
      const count = Number(weeks);
      if (!Number.isInteger(count) || count < 1 || count > 52) {
        setError("Enter a whole number of weeks from 1 to 52.");
        return;
      }
      const date = new Date(`${anchorMonday}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorMonday) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== anchorMonday || date.getUTCDay() !== 1) {
        setError("Choose a valid Monday for the first week.");
        return;
      }
      setup = { kind: "rotation", anchorMonday, cycleWeeks: count };
    }
    setCreating(true);
    setError("");
    try {
      await onCreate(selected.itemId, setup);
      dialog.current?.close();
    } catch (failure) {
      setError((failure as Error).message || "The menu draft could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.home}>
      <StudioPageHeader title="Menu Builder" description="Choose a Hospitality product to create or continue its menu draft." />
      <p className={styles.draftBoundary}>Menu drafts are not customer offerings. The current verified menu and booking rules remain in effect until a separate approved publication and activation flow is available.</p>
      <section className={styles.listPanel} aria-labelledby="products-heading">
        <div className={styles.listHeader}>
          <div><h2 id="products-heading">Hospitality products</h2><p>Menus use the product’s canonical catalogue identity.</p></div>
          <StudioStatus>{products.length} products</StudioStatus>
        </div>
        <div className={styles.filters}>
          <StudioField label="Search products">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or category" />
          </StudioField>
          <StudioField label="Draft status">
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">All products</option><option value="configured">Product draft exists</option><option value="not-configured">No product draft</option>
            </select>
          </StudioField>
        </div>
        <div className={styles.rows}>
          {visible.map((product) => {
            const summary = configured.get(product.itemId);
            const description = summary?.kind === "fixed" ? `Fixed menu · ${summary.dishCount ?? 0} dishes`
              : summary ? `${summary.cycleWeeks}-week rotation` : "No product draft";
            return <article className={styles.row} key={product.itemId}>
              <div className={styles.productCopy}>
                <h3>{product.name}</h3><p>{product.category || "Hospitality product"}</p>
              </div>
              <div className={styles.menuInfo}>
                <p>{description}</p>
                <StudioStatus tone={summary ? "info" : "neutral"}>{summary ? "Draft" : "No product draft"}</StudioStatus>
              </div>
              <div className={styles.rowAction}>
                {summary
                  ? <StudioButton variant="primary" onClick={() => onOpen(product.itemId)}>Open menu</StudioButton>
                  : <StudioButton variant="primary" disabled={!canManage} disabledReason="Your account has read-only access to menu drafts." onClick={() => startCreate(product)}>Create menu</StudioButton>}
              </div>
            </article>;
          })}
          {!visible.length && <p className={styles.empty} role="status">{products.length ? "No products match this search and filter." : "No Hospitality products are available."}</p>}
        </div>
      </section>
      <dialog className={styles.dialog} ref={dialog} aria-labelledby="create-menu-title" onClose={() => setSelected(null)}>
        <div className={styles.dialogHeader}><div><h2 id="create-menu-title">Create a menu</h2><p>{selected?.name}</p></div><button type="button" className={styles.close} aria-label="Close" onClick={() => dialog.current?.close()}>×</button></div>
        <fieldset className={styles.menuType}>
          <legend>Menu type</legend>
          <label><input type="radio" name="menu-kind" checked={kind === "fixed"} onChange={() => setKind("fixed")} /><span><strong>Fixed menu</strong><small>One ordered set of dishes</small></span></label>
          <label><input type="radio" name="menu-kind" checked={kind === "rotation"} onChange={() => setKind("rotation")} /><span><strong>Rotating menu</strong><small>A repeating set of weekly choices</small></span></label>
        </fieldset>
        {kind === "rotation" && <div className={styles.rotationFields}>
          <StudioField label="Number of weeks" hint="Choose from 1 to 52 weeks."><input type="number" min="1" max="52" step="1" value={weeks} onChange={(event) => setWeeks(event.target.value)} /></StudioField>
          <StudioField label="First week starts on" hint="The rotation must start on a Monday."><input type="date" value={anchorMonday} onChange={(event) => setAnchorMonday(event.target.value)} /></StudioField>
        </div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.dialogActions}><StudioButton onClick={() => dialog.current?.close()}>Cancel</StudioButton><StudioButton variant="primary" busy={creating} onClick={() => void create()}>{creating ? "Creating…" : "Create menu"}</StudioButton></div>
      </dialog>
    </div>
  );
}
