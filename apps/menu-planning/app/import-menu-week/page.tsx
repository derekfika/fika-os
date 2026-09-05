"use client";

import { useMemo, useState } from "react";
import MenuPlanningShell from "../menu-planning-shell";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";
import type { DishResolution } from "@/lib/legacy-week-importer";

type DishOption = { id: string; name: string };
type Decision = DishResolution & { canonicalId?: string; remember?: boolean; ignored?: boolean };

export default function ImportMenuWeekPage() {
  const [snapshot, setSnapshot] = useState<RollingSnapshot>();
  const [resolutions, setResolutions] = useState<Decision[]>([]);
  const [catalogue, setCatalogue] = useState<DishOption[]>([]);
  const [fileName, setFileName] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const reviewCount = resolutions.filter(item => !item.canonicalId && !item.ignored).length;
  const visible = useMemo(() => resolutions.filter(item => filter === "all" || (filter === "matched" ? Boolean(item.canonicalId) : filter === "review" ? !item.canonicalId && !item.ignored : Boolean(item.ignored))), [filter, resolutions]);
  const filteredCatalogue = useMemo(() => catalogue.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 80), [catalogue, search]);

  const check = async (file: File) => {
    setBusy(true); setError(""); setFileName(file.name);
    try {
      const response = await fetch("/api/rolling-menu/import", { method: "POST", headers: { "content-type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-workbook-name": file.name }, body: await file.arrayBuffer() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "We couldn't read this spreadsheet.");
      setSnapshot(body.snapshot); setResolutions(body.resolutions || []); setCatalogue(body.catalogue || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't read this spreadsheet."); }
    finally { setBusy(false); }
  };

  const choose = (sourceName: string, canonicalId: string) => setResolutions(current => current.map(item => item.sourceName === sourceName ? { ...item, canonicalId, canonicalName: catalogue.find(option => option.id === canonicalId)?.name, ignored: false, remember: true } : item));
  const ignore = (sourceName: string) => setResolutions(current => current.map(item => item.sourceName === sourceName ? { ...item, ignored: true, canonicalId: undefined } : item));
  const commit = async () => {
    if (!snapshot || reviewCount) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rolling-menu/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "commit", snapshot, resolutions }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The menu week could not be imported.");
      setMessage("Menu week imported as planning source. Your Dish Library was not changed."); setSnapshot(undefined); setResolutions([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The menu week could not be imported."); }
    finally { setBusy(false); }
  };

  return <MenuPlanningShell section="Planner"><main className="import-menu-week" style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 28px", color: "#f5f5f5" }}>
    <p style={{ color: "#8ee8c5", letterSpacing: ".12em", fontSize: 12 }}>MENU PLANNING</p>
    <h1 style={{ fontSize: 42, margin: "8px 0" }}>Import a menu week</h1>
    <p style={{ maxWidth: 680, color: "#b5c1bd", fontSize: 17 }}>Upload Brian&apos;s weekly menu spreadsheet. We&apos;ll match the dishes to your existing Dish Library before anything is added.</p>
    {!snapshot && <label style={{ display: "block", border: "1px dashed #58756d", borderRadius: 18, padding: 48, marginTop: 32, textAlign: "center", cursor: "pointer" }}><strong>{busy ? "Checking spreadsheet…" : "Choose an Excel spreadsheet"}</strong><br /><span style={{ color: "#9aa9a4" }}>.xlsx or .xls · nothing is imported yet</span><input type="file" accept=".xlsx,.xls" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void check(file); }} /></label>}
    {snapshot && <>
      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "30px 0" }}>{[[resolutions.length, "dish names found"], [resolutions.filter(item => item.canonicalId).length, "matched"], [reviewCount, "need a quick check"], [resolutions.filter(item => item.ignored).length, "ignored"]].map(([value, label]) => <div key={String(label)} style={{ background: "#182923", borderRadius: 14, padding: "16px 20px", minWidth: 150 }}><strong style={{ display: "block", fontSize: 25 }}>{value}</strong><span style={{ color: "#b5c1bd" }}>{label}</span></div>)}</section>
      <p style={{ color: "#8ee8c5" }}>Workbook: {fileName} · Dish Library will not be changed.</p>
      <nav style={{ display: "flex", gap: 8, margin: "20px 0" }}>{[["all", "All"], ["review", "Needs review"], ["matched", "Matched"], ["ignored", "Ignored"]].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} style={{ padding: "9px 14px", borderRadius: 999, border: "1px solid #466158", background: filter === value ? "#8ee8c5" : "transparent", color: filter === value ? "#102019" : "#e6eee9" }}>{label}</button>)}</nav>
      <div style={{ display: "grid", gap: 12 }}>{visible.map(item => <article key={item.sourceName} style={{ background: "#182923", borderRadius: 14, padding: 18 }}><strong>{item.sourceName}</strong><span style={{ display: "block", color: "#9aa9a4", margin: "4px 0 12px" }}>Used {item.occurrences} time{item.occurrences === 1 ? "" : "s"} in this upload</span>{item.canonicalId ? <span style={{ color: "#8ee8c5" }}>Matched to {item.canonicalName}</span> : item.ignored ? <span style={{ color: "#e3bd73" }}>Ignored</span> : <><span style={{ display: "block", color: "#e3bd73", marginBottom: 8 }}>{item.suggestions.length ? "Check this match" : "Choose a dish from the Dish Library"}</span>{item.suggestions.map(suggestion => <button key={suggestion.id} onClick={() => choose(item.sourceName, suggestion.id)} style={{ margin: "4px 8px 4px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid #466158", background: "#22372f", color: "#f5f5f5" }}>Use {suggestion.name}</button>)}<input aria-label={`Search Dish Library for ${item.sourceName}`} placeholder="Search Dish Library" value={search} onChange={event => setSearch(event.target.value)} style={{ display: "block", margin: "8px 0", padding: 9, width: "min(100%, 360px)", background: "#102019", color: "#fff", border: "1px solid #466158", borderRadius: 8 }} /><select aria-label={`Choose existing dish for ${item.sourceName}`} defaultValue="" onChange={event => event.target.value && choose(item.sourceName, event.target.value)} style={{ padding: 8, maxWidth: "100%", background: "#102019", color: "#fff", borderRadius: 8 }}><option value="">Choose from Dish Library</option>{filteredCatalogue.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button onClick={() => ignore(item.sourceName)} style={{ marginLeft: 8, padding: "8px 12px" }}>Ignore</button></>}</article>)}</div>
      <section style={{ marginTop: 28, padding: 20, border: "1px solid #466158", borderRadius: 14 }}><h2>Ready to import</h2><p>{resolutions.filter(item => item.canonicalId).length} matched · {resolutions.filter(item => item.ignored).length} ignored · 0 new dishes will be created.</p><p><strong>Your Dish Library will not be changed.</strong></p><button disabled={Boolean(reviewCount) || busy} onClick={() => void commit()} style={{ padding: "12px 20px", borderRadius: 9, background: reviewCount ? "#52635d" : "#8ee8c5", color: "#102019", border: 0, fontWeight: 700 }}>{busy ? "Importing…" : "Import menu weeks"}</button></section>
    </>}
    {error && <p role="alert" style={{ color: "#ffb4a8", marginTop: 20 }}>{error}</p>}{message && <p role="status" style={{ color: "#8ee8c5", marginTop: 20 }}>{message}</p>}
  </main></MenuPlanningShell>;
}
