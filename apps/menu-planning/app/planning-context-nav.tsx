"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RollingDay } from "@/lib/rolling-menu-types";

type Week = { id: string; weekCommencing: string };
const humanDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const shortDay = (day: RollingDay) => <><strong>{day.dayName.slice(0, 3).toUpperCase()}</strong><span>{new Date(`${day.date}T12:00:00Z`).getUTCDate()}</span></>;

export default function PlanningContextNav({ weeks, currentWeek, days, showDay = false }: { weeks: Week[]; currentWeek: string; days?: RollingDay[]; showDay?: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const index = weeks.findIndex(week => week.id === currentWeek); const week = weeks[index];
  const selectedDayIndex = days?.length ? Math.max(0, days.findIndex(day => day.date === params.get("day") || day.id === params.get("day"))) : 0;
  const navigate = (weekId: string, day?: string) => { const next = new URLSearchParams(params.toString()); const target = weeks.find(item => item.id === weekId); if (target) next.set("week", target.weekCommencing); else next.delete("week"); if (showDay && days?.length) { const targetDate = new Date(`${target?.weekCommencing || days[0].date}T00:00:00Z`); targetDate.setUTCDate(targetDate.getUTCDate() + selectedDayIndex); next.set("day", day || targetDate.toISOString().slice(0, 10)); } else if (!showDay) next.delete("day"); router.push(`${pathname}${next.toString() ? `?${next}` : ""}`); };
  const changeDay = (day: string) => { const next = new URLSearchParams(params.toString()); next.set("day", day); if (week) next.set("week", week.weekCommencing); router.push(`${pathname}?${next}`); };
  return <section className="planning-context" aria-label="Planning context"><div className="planning-week-nav"><button className="context-arrow" aria-label="Previous week" disabled={index <= 0} onClick={() => index > 0 && navigate(weeks[index - 1].id)}>←</button><strong>WC {week ? humanDate(week.weekCommencing) : "—"}</strong><button className="context-arrow" aria-label="Next week" disabled={index < 0 || index >= weeks.length - 1} onClick={() => index >= 0 && index < weeks.length - 1 && navigate(weeks[index + 1].id)}>→</button></div>{showDay && days?.length ? <nav className="planning-days" aria-label="Planning days">{days.slice(0, 5).map(day => <button key={day.id} className={params.get("day") === day.date || (!params.get("day") && day.id === days[0].id) ? "active" : ""} onClick={() => changeDay(day.date)}>{shortDay(day)}</button>)}</nav> : null}</section>;
}
