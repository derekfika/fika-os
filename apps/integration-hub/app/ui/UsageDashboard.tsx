"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./usage-dashboard.module.css";
import type { UsageDashboard as UsageData, UsageMetric, UsagePoint } from "@/lib/usage-observatory";

const labels: Record<UsageMetric, string> = { reads: "Reads", writes: "Writes", deletes: "Deletes" };
const format = new Intl.NumberFormat("en-GB");
const display = (value: number | null | undefined) => value === null || value === undefined ? "Unavailable" : format.format(value);
const localInput = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day + "T" + values.hour + ":" + values.minute;
};
function londonInputToIso(value: string) {
  const wall = new Date(value + ":00Z");
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "longOffset" }).formatToParts(wall).find(part => part.type === "timeZoneName")?.value || "GMT";
  const match = zone.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offset = match ? (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === "+" ? 1 : -1) : 0;
  return new Date(wall.getTime() - offset * 60000).toISOString();
}

export default function UsageDashboard() {
  const now = new Date();
  const [data, setData] = useState<UsageData>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [preset, setPreset] = useState("7d"); const [start, setStart] = useState(localInput(new Date(now.getTime() - 7 * 86400000))); const [end, setEnd] = useState(localInput(now));
  const load = useCallback(async (refresh = false, customStart = start, customEnd = end) => {
    setError(""); refresh ? setBusy(true) : setLoading(true);
    try {
      const params = new URLSearchParams();
      if (preset === "custom") { params.set("start", londonInputToIso(customStart)); params.set("end", londonInputToIso(customEnd)); } else params.set("preset", preset);
      const response = await fetch("/api/usage?" + params, { method: refresh ? "POST" : "GET", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error?.message === "string" ? body.error.message : "Usage data could not be loaded.");
      setData(body as UsageData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Usage data could not be loaded."); } finally { setLoading(false); setBusy(false); }
  }, [end, preset, start]);
  useEffect(() => { void load(); }, [load, preset]);
  function selectPreset(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const current = new Date(); const duration = value === "today" ? current.getTime() - Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(current) + "T00:00:00Z") : value === "24h" ? 86400000 : 7 * 86400000;
    setStart(localInput(new Date(current.getTime() - duration))); setEnd(localInput(current));
  }
  if (loading && !data) return <main className={styles.page}><p className={styles.loading}>Loading usage observatory…</p></main>;
  return <main className={styles.page}><header className={styles.header}><div><p className={styles.eyebrow}>Integration Hub · Internal operations</p><h1>Usage <em>observatory.</em></h1><p>Server-side visibility into Firestore operation volume after a deploy.</p></div><div className={styles.actions}><button onClick={() => void load(true)} disabled={busy}>Refresh</button><a href="/">Back to FIKA OS</a></div></header>
    <section className={styles.controls}><label>Window<select value={preset} onChange={event => selectPreset(event.target.value)}><option value="15m">Last 15 minutes</option><option value="30m">Last 30 minutes</option><option value="1h">Last 1 hour</option><option value="today">Today</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="custom">Custom</option></select></label>{preset === "custom" && <><label>Start<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label><label>End<input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label><button onClick={() => void load(false, start, end)}>Apply window</button></>}</section>
    {error && <div className={styles.warning} role="alert"><strong>Monitoring data unavailable</strong><span>{error}{data ? " Showing the last valid cached result." : " No usage totals are shown."}</span></div>}
    {data && <><section className={styles.cards}>{(["reads", "writes", "deletes"] as UsageMetric[]).map(metric => <article key={metric}><strong>{display(data.totals[metric])}</strong><span>{labels[metric]} in range</span><small>{data.metricErrors[metric] || "Google Cloud Monitoring"}</small></article>)}<article className={styles.allowance}><strong>{data.allowance ? (data.allowance.percent * 100).toFixed(1) + "%" : "—"}</strong><span>Allowance used</span><small>{data.allowance ? display(data.allowance.remaining) + " reads remaining" : "No configured allowance"}</small></article></section>
    <section className={styles.grid}><article className={styles.panel}><div className={styles.heading}><div><p className={styles.eyebrow}>Selected range · {data.resolution} buckets</p><h2>Firestore operations</h2></div></div><div className={styles.axisTitles}><span>Operations</span><div className={styles.timeline}>{(["reads", "writes", "deletes"] as UsageMetric[]).map(metric => <Bars key={metric} label={labels[metric]} points={data.timeline[metric]} resolution={data.resolution} />)}</div><span>Time</span></div></article><aside className={styles.panel}><p className={styles.eyebrow}>Read health</p><h2>{data.allowance?.status || "Not configured"}</h2><dl className={styles.facts}><div><dt>Headroom</dt><dd>{data.allowance ? format.format(data.allowance.remaining) : "Not enough configuration"}</dd></div><div><dt>Regression signal</dt><dd>{data.baseline.message}</dd></div><div><dt>Business timezone</dt><dd>Europe/London</dd></div></dl></aside></section>
    <section className={styles.panel}><p className={styles.eyebrow}>Usage by app</p><h2>Attribution</h2><p>{data.appUsage.message}</p><p className={styles.muted}>Authoritative platform totals remain separate from future aggregated app counters. No percentages are displayed while attribution is incomplete.</p></section>
    <section className={styles.lower}><article className={styles.panel}><p className={styles.eyebrow}>Query Insights</p><h2>Expensive query families</h2><p>{data.queryInsights.message}</p><a href={data.queryInsights.url} target="_blank" rel="noreferrer">Open Firebase Query Insights ↗</a></article><article className={styles.panel}><p className={styles.eyebrow}>Deploy diagnostics</p><h2>Context availability</h2><p>{data.deployMarkers.message}</p></article></section><footer className={styles.footer}>Last updated {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} · {data.source.label}</footer></>}</main>;
}
function Bars({ label, points, resolution }: { label: string; points: UsagePoint[]; resolution: UsageData["resolution"] }) {
  const max = Math.max(1, ...points.map(point => point.value)); const ticks = [0, 0.25, 0.5, 0.75, 1];
  const tickIndexes = points.length < 2 ? [0] : Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const tickLabel = (point: UsagePoint) => { const date = new Date(point.timestamp); return resolution === "1d" ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }); };
  return <div className={styles.series}><strong>{label}</strong><div className={styles.chartFrame}><div className={styles.yTicks}>{ticks.slice().reverse().map(tick => <span key={tick}>{format.format(Math.round(max * tick))}</span>)}</div><div className={styles.chartPlot}><div className={styles.gridlines}>{ticks.map(tick => <i key={tick} style={{ bottom: tick * 100 + "%" }} />)}</div><div className={styles.bars} aria-label={label + " over selected range"}>{points.map(point => <span key={point.timestamp} title={format.format(point.value) + " operations"} style={{ height: Math.max(2, point.value / max * 100) + "%" }} />)}</div><div className={styles.xTicks}>{tickIndexes.map(index => <span key={points[index]?.timestamp || index}>{points[index] ? tickLabel(points[index]) : "—"}</span>)}</div></div></div></div>;
}
