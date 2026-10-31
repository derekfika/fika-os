"use client";
import styles from "./food-data.module.css";

export const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const gbpPrecise = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const integer = new Intl.NumberFormat("en-GB");
export function snapshotLabel(snapshot: string) {
  const [year, month, day] = snapshot.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
export const blank = (value: string) => value.trim() === "" ? <span className={styles.muted}>Not in source</span> : value;

/** Allergen block: values are Y (contains), May (may contain), N (no), blank (not recorded). Never colour-only. */
export function Allergens({ allergens, recorded }: { allergens: { allergen: string; value: string }[]; recorded: boolean }) {
  const noAllergensFlag = allergens.find(entry => entry.allergen === "No allergens")?.value ?? "";
  const rows = allergens.filter(entry => entry.allergen !== "No allergens");
  const contains = rows.filter(entry => entry.value === "Y"); const may = rows.filter(entry => entry.value === "May");
  const unrecorded = rows.filter(entry => entry.value.trim() === "");
  if (!recorded) return <p className={`${styles.note} ${styles.noteWarn}`} role="note">Allergens are not recorded in the source export. This is not the same as allergen-free.</p>;
  return <div>
    <p className={styles.muted} style={{ margin: "0 0 8px", fontSize: "var(--text-sm)" }}>Contains</p>
    {contains.length ? <ul className={styles.chips}>{contains.map(entry => <li key={entry.allergen} className={`${styles.badge} ${styles.badgeDanger}`}>Contains: {entry.allergen}</li>)}</ul> : <p style={{ margin: 0 }}>None marked as contained.</p>}
    <p className={styles.muted} style={{ margin: "12px 0 8px", fontSize: "var(--text-sm)" }}>May contain</p>
    {may.length ? <ul className={styles.chips}>{may.map(entry => <li key={entry.allergen} className={`${styles.badge} ${styles.badgeWarn}`}>May contain: {entry.allergen}</li>)}</ul> : <p style={{ margin: 0 }}>None marked as may contain.</p>}
    {unrecorded.length > 0 && <p className={styles.muted} style={{ fontSize: "var(--text-sm)" }}>{unrecorded.length} allergen column{unrecorded.length === 1 ? "" : "s"} blank in the source (not recorded): {unrecorded.map(entry => entry.allergen).join(", ")}.</p>}
    <p className={styles.muted} style={{ fontSize: "var(--text-sm)" }}>Source “No allergens” flag: {noAllergensFlag.trim() === "" ? "blank" : noAllergensFlag}. Shown as exported, not as a safety statement.</p>
  </div>;
}

export function Nutrition({ items, basis }: { items: { label: string; value: string; unit: string }[]; basis: string }) {
  return <>
    <table className={styles.table}><caption className={styles.visuallyHidden}>Nutrition</caption><thead><tr><th scope="col">Nutrient</th><th scope="col">Value</th></tr></thead>
      <tbody>{items.map(item => <tr key={`${item.label}${item.unit}`}><th scope="row">{item.label}</th><td>{item.value.trim() === "" ? <span className={styles.muted}>Not in source</span> : `${item.value} ${item.unit}`}</td></tr>)}</tbody></table>
    <p className={styles.muted} style={{ fontSize: "var(--text-xs)" }}>{basis}</p>
  </>;
}

export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) { return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}</div>; }
