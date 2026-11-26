"use client";

import { useMemo, useRef, useState } from "react";
import { normalizeCatalogueSearch, type StudioProduct } from "./studio-catalogue-index";
import type { ProductMenuListing } from "../../shared/hospitality-menu-studio-product-content";
import { filterMenuBuilderProducts, menuChoicesForCategory } from "./menu-builder-home-model";
import { StudioButton, StudioField, StudioPageHeader, StudioSegmentedControl, StudioStatus } from "./studio-design-system";
import styles from "./menu-builder-home.module.css";

export type { ProductMenuListing as ProductMenuSummary } from "../../shared/hospitality-menu-studio-product-content";

export type ProductMenuSetup = { kind: "fixed" } | { kind: "rotation"; anchorMonday: string; cycleWeeks: number };

export function MenuBuilderHome({
  products,
  summaries,
  canManage = true,
  onOpen,
  onCreate,
}: {
  products: StudioProduct[];
  summaries: ProductMenuListing[];
  canManage?: boolean;
  onOpen: (itemId: string) => void;
  onCreate: (itemId: string, setup: ProductMenuSetup) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "not-configured">("all");
  const [selected, setSelected] = useState<StudioProduct | null>(null);
  const [kind, setKind] = useState<"fixed" | "rotation">("fixed");
  const [weeks, setWeeks] = useState("4");
  const [anchorMonday, setAnchorMonday] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const configured = useMemo(() => new Map(summaries.map((item) => [item.itemId, item])), [summaries]);
  const configuredIds = useMemo(() => new Set(configured.keys()), [configured]);
  const publishedIds = useMemo(() => new Set(summaries.filter(item => item.publicationStatus === "published").map(item => item.itemId)), [summaries]);
  const searchable = useMemo(() => new Map(products.map(product => [product.itemId, normalizeCatalogueSearch(product.name + " " + product.category)])), [products]);
  const visible = useMemo(() => {
    return filterMenuBuilderProducts(products, configuredIds, query, statusFilter, publishedIds, searchable);
  }, [configuredIds, products, query, statusFilter, publishedIds, searchable]);

  function startCreate(product: StudioProduct) {
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
      <StudioPageHeader title="Menu Builder" description="Choose a Hospitality product to create or continue its menu." />
      <p className={styles.draftBoundary}>Draft menus do not change customer availability.</p>
      <section className={styles.listPanel} aria-labelledby="products-heading">
        <div className={styles.listHeader}>
          <div><h2 id="products-heading">Hospitality products</h2><p>Choose a product to open its menu.</p></div>
          <StudioStatus>{products.length} products</StudioStatus>
        </div>
        <div className={styles.filters}>
          <StudioField label="Search products">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" />
          </StudioField>
          <StudioSegmentedControl label="Menu status" value={statusFilter} options={[{ value: "all", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "not-configured", label: "Not configured" }]} onChange={setStatusFilter} />
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.productTable}>
            <thead><tr><th scope="col">Product</th><th scope="col">Menu</th><th scope="col"><span className={styles.srOnly}>Action</span></th></tr></thead>
            <tbody>
              {visible.map((product) => {
                const summary = configured.get(product.itemId);
                const menuChoices = menuChoicesForCategory(product.category);
                const description = summary?.kind === "fixed" ? `Fixed menu · ${summary.dishCount ?? 0} dishes`
                  : summary ? `${summary.cycleWeeks}-week rotation` : menuChoices ? "No menu yet" : "No dish menu";
                return <tr key={product.itemId}>
                  <th scope="row"><span className={styles.productName}>{product.name}</span><span className={styles.category}>{product.category || "Hospitality product"}</span></th>
                  <td>{summary ? <><StudioStatus tone={summary.publicationStatus === "published" ? "success" : "info"}>{summary.publicationStatus === "published" ? "Published to Hub" : summary.publicationStatus === "unavailable" ? "Status unavailable" : summary.hasPublishedRevision ? "Draft · prior version published" : "Draft"}</StudioStatus><span className={styles.menuDescription}>{description}</span></> : <span className={menuChoices ? styles.emptyStatus : styles.category}>{description}</span>}</td>
                  <td className={styles.actionCell}>
                    {summary
                      ? <StudioButton variant="primary" onClick={() => onOpen(product.itemId)}>Open menu</StudioButton>
                      : menuChoices && <StudioButton variant="primary" disabled={!canManage} disabledReason="Your account has read-only access to menu drafts." onClick={() => startCreate(product)}>Create menu</StudioButton>}
                  </td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={3} className={styles.empty} role="status">{products.length ? "No products match this search and menu status." : "No Hospitality products are available."}</td></tr>}
            </tbody>
          </table>
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
