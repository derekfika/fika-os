"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicationHandoff } from "@/lib/publication-handoff";

export default function PublicationHandoffStatus({ weekId, version, initial }: { weekId: string; version: number; initial?: PublicationHandoff }) {
  const [handoff, setHandoff] = useState<PublicationHandoff>();
  const [label, setLabel] = useState("Published");
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/rolling-menu/publications?publicationId=${encodeURIComponent(`menu-publication:${weekId}`)}`, { cache: "no-store" });
      if (current !== generation.current) return;
      if (response.status === 404) { setHandoff(undefined); setUnavailable(false); return; }
      if (!response.ok) throw new Error("Handoff status unavailable");
      const body = await response.json();
      if (current !== generation.current) return;
      setHandoff(body.handoff);
      setLabel(body.publication.days.some((day: { status: string }) => day.status === "published") ? "Published" : "Withdrawn");
      setUnavailable(false);
    } catch { if (current === generation.current) setUnavailable(true); }
    finally { if (current === generation.current) setLoading(false); }
  }, [weekId]);
  useEffect(() => {
    setHandoff(initial);
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh, version, initial]);
  if (!handoff && !unavailable) return null;
  const text = unavailable ? "Downstream handoff status unavailable" : `${label} · downstream handoff ${handoff?.status === "intervention-required" ? "requires intervention" : handoff?.status}`;
  return <div className="planner-toolbar"><span role="status">{text}</span><button type="button" className="button button-soft" disabled={loading} onClick={() => void refresh()}>{loading ? "Checking handoff…" : "Refresh handoff status"}</button></div>;
}
