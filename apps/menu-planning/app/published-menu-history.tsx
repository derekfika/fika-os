"use client";
import { useEffect, useState } from "react";
type PublishedDay = { publicationDayId: string; date: string; dayName: string; version: number; status: string; publishedAt: string; publishedBy: string; withdrawal?: { reason: string; at: string } };
type Publication = { publicationId: string; weekCommencing: string; days: PublishedDay[] };
export default function PublishedMenuHistory() {
  const [publications, setPublications] = useState<Publication[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Only a successful 2xx response with a publications array is history; any other response is an error, never an empty record.
    void fetch("/api/rolling-menu/publications", { cache: "no-store" })
      .then(async response => { const body = await response.json().catch(() => undefined) as { publications?: Publication[]; error?: { message?: string } } | undefined; if (!response.ok || !Array.isArray(body?.publications)) throw new Error(body?.error?.message || "Published menu history could not be loaded."); setPublications(body.publications); setError(""); })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Published menu history could not be loaded."))
      .finally(() => setLoading(false));
  }, []);
  return <section className="workspace-panel published-history-panel"><header className="panel-header"><div><small>Read-only operational record</small><h3>Published menus</h3></div><span className="status status--published">History</span></header>{error && <p className="menu-error" role="alert">{error}</p>}{loading && !error ? <p className="form-help" role="status">Loading published menus…</p> : !publications.length && !error ? <p className="form-help">No published menu days yet.</p> : <div className="library-list">{publications.flatMap(publication => publication.days.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(day => <article className="library-row" key={day.publicationDayId}><div><strong>WC {new Date(`${publication.weekCommencing}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {day.dayName}</strong><span>Published v{day.version} · {day.status}</span><small>{new Date(day.publishedAt).toLocaleString("en-GB")} · {day.publishedBy}{day.withdrawal ? ` · Withdrawal: ${day.withdrawal.reason}` : ""}</small></div><span className={`status status--${day.status}`}>{day.status}</span></article>))}</div>}</section>;
}
