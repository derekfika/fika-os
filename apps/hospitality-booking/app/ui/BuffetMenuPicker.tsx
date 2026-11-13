"use client";
import { useEffect, useState } from "react";
import { BuffetMenuDialog } from "./BuffetMenuDialog";
import { buffetMenuView, buffetPackageForItem, buffetSubmissionEnabled, loadBuffetConfig, parseBuffetPreview, type BuffetConfig, type BuffetPreview } from "../../lib/buffet-menu-client";
import type { PortalMenuItem } from "../../lib/mnk-contract";
import styles from "./BuffetMenuDialog.module.css";

export function useBuffetConfig(enabled = true) {
  const [config, setConfig] = useState<BuffetConfig>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || process.env.NEXT_PUBLIC_FIKA_HOT_FORK_BUFFET_ENABLED !== "true") return;
    const controller = new AbortController();
    void loadBuffetConfig(controller.signal).then(setConfig).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [enabled]);
  return { config, error };
}

export function BuffetMenuPicker({ config, item, catalogue, selectedItemIds, guestCount, preview, dietaryNotes, onSave }: { config?: BuffetConfig; item: PortalMenuItem; catalogue: readonly PortalMenuItem[]; selectedItemIds: readonly string[]; guestCount: number; preview?: BuffetPreview; dietaryNotes: string; onSave: (item: PortalMenuItem, preview: BuffetPreview, dietaryNotes: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!config) return null;
  const pkg = buffetPackageForItem(config, item.id);
  if (!pkg) return null;
  const view = buffetMenuView(config, catalogue, selectedItemIds, item.id);
  const parsedPreview = parseBuffetPreview(preview);
  const validSelection = parsedPreview?.menuVersion === config.menuVersion ? parsedPreview.selection : undefined;
  const needsResave = Boolean(validSelection && parsedPreview?.rulesVersion !== config.rulesVersion);
  return <div className={styles.picker} data-buffet-item-id={item.id}>
    {preview && !validSelection && <p role="alert">The menu has changed since this selection was saved. Please choose again.</p>}
    {needsResave && <p role="status">The buffet rules have changed. Please review and save your selection again.</p>}
    {validSelection && <BuffetSelectionSummary config={config} preview={preview} />}
    <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{validSelection ? "Edit menu" : "Choose Menu"}</button>
    {open && <BuffetMenuDialog menu={view} guestCount={guestCount} initialPackageId={pkg.id} selection={validSelection} dietaryNotes={dietaryNotes} onCancel={() => setOpen(false)} onSave={(selection, notes) => {
      const target = config.packages.find(candidate => candidate.id === selection.packageId);
      const targetItem = catalogue.find(candidate => target?.canonicalItemIds.includes(candidate.id));
      if (!targetItem) return;
      onSave(targetItem, { menuVersion: config.menuVersion, rulesVersion: config.rulesVersion, selection }, notes); setOpen(false);
      if (targetItem.id !== item.id) window.setTimeout(() => {
        const picker = [...document.querySelectorAll<HTMLElement>("[data-buffet-item-id]")].find(element => element.dataset.buffetItemId === targetItem.id);
        picker?.querySelector<HTMLButtonElement>("button")?.focus();
      }, 0);
    }} />}
  </div>;
}

export function BuffetSelectionSummary({ config, preview }: { config?: BuffetConfig; preview?: BuffetPreview }) {
  if (!preview) return null;
  const parsed = parseBuffetPreview(preview);
  if (!config || !parsed || parsed.menuVersion !== config.menuVersion) return <p>Saved buffet selection needs review.</p>;
  const selection = parsed.selection;
  const ids = [selection.nonVegetarianMainId, selection.vegetarianMainId, ...selection.saladIds, ...selection.dessertIds];
  return <div className={styles.picker}><strong>Menu selection</strong>{ids.map(id => { const item = config.dishes.find(dish => dish.id === id); const portions = selection.mainPortions[id]; return <span className={styles.summaryDish} key={id}>{item?.name || "Saved dish no longer available"}{portions ? ` · ${portions} portions` : ""}</span>; })}{!buffetSubmissionEnabled(config) && <p>Preview only; live ordering is awaiting approval.</p>}</div>;
}
