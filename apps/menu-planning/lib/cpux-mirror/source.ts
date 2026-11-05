import { assertOneOffMenuDestination } from "@fika/server-shared/menu-destination";
import { calendarDate, nextCalendarDate, type MirrorDetails, type MirrorSource } from "../../../shared/cpux-calendar/contract";
import type { MenuPublication, PublishedMenuDay } from "../menu-publication";

export const DELIVERED_IN_MIRROR_EVENT = "cpux.calendar.delivered-in";

export function weekForServiceDate(date: string) {
  const time = calendarDate(date);
  const day = new Date(time).getUTCDay();
  return new Date(time - ((day + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
const html = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export type MirrorOploc = { sourceId: string; canonicalId: string; label: string; address: string | null };
export function deliveredInOplocIds(date: string, publications: readonly MenuPublication[]) {
  return [...new Set(publications.flatMap(publication => publication.publicationStatus === "withdrawn" ? [] : publication.days
    .filter(day => day.date === date && day.status === "published").flatMap(day => day.entries.flatMap(entry => entry.allocations
      .flatMap(allocation => allocation.destination?.kind === "one-off" ? [] : [allocation.destination?.id || allocation.destinationId].filter((id): id is string => Boolean(id)))))))];
}

export function deliveredInMirrorSource(date: string, publications: readonly MenuPublication[], oplocs?: ReadonlyMap<string, MirrorOploc>) {
  calendarDate(date);
  const candidates = publications.flatMap(publication => publication.days.filter(day => day.date === date).map(day => ({ publication, day })));
  const current = candidates.filter(({ publication, day }) => publication.publicationStatus !== "withdrawn" && day.status === "published");
  if (current.length > 1) throw new Error("Multiple current publications claim this service date.");
  const withdrawn = candidates.filter(({ day }) => day.status === "withdrawn").sort((a, b) => (b.day.withdrawal?.at || "").localeCompare(a.day.withdrawal?.at || ""));
  const chosen = current[0] || withdrawn[0];
  if (!chosen) return;
  const { publication, day } = chosen;
  const groups = new Map<string, { label: string; address: string; instructions?: string; lines: Array<{ name: string; portions: number; slot: string }> }>();
  if (day.status === "published") addAllocations(groups, day, oplocs);
  const source: MirrorSource = {
    stream: "delivered-in", identity: date, revision: Date.parse(day.status === "withdrawn" ? day.withdrawal?.at || "" : day.publishedAt),
    sourceReference: JSON.stringify([publication.publicationId, day.publicationDayId, day.version, day.contentHash, day.status, [...groups].map(([id, group]) => [id, group.address, group.label]).sort()]),
    withdrawn: !groups.size,
  };
  if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error("The publication lacks a verified revision timestamp.");
  const title = "Delivered-In run sheet — " + date + ".pdf";
  if (source.withdrawn) return { source, title };
  const reference = publication.publicationId + " / " + day.publicationDayId + " v" + day.version;
  const rows = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const details: MirrorDetails = {
    summary: "Delivered-In production — " + date,
    description: [
      "Service date: " + date,
      "Publication: " + reference,
      "FIKA OS: https://delivered-in.fikacatering.com/",
      ...rows.flatMap(([id, site]) => ["", site.label + " (" + id + ")", site.address,
        ...(site.instructions ? [site.instructions] : []), ...site.lines.map(line => "• " + line.name + " — " + line.portions + " portions")]),
    ].join("\n"),
    start: { date }, end: { date: nextCalendarDate(date) },
  };
  const runSheetHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${html(title)}</title>
<style>@page{size:A4;margin:15mm}body{font:11pt sans-serif;color:#111}h1{font-size:20pt}h2{font-size:14pt;break-after:avoid}table{width:100%;border-collapse:collapse}tr{break-inside:avoid}th,td{padding:5pt;border-bottom:1px solid #aaa;text-align:left}thead{display:table-header-group}</style>
<h1>Delivered-In run sheet — ${html(date)}</h1><p>Publication: ${html(reference)}</p>
${rows.map(([id, site]) => `<section><h2>${html(site.label)}</h2><p>${html(site.address)}<br>${html(id)}${site.instructions ? "<br>" + html(site.instructions) : ""}</p>
<table><thead><tr><th>Dish</th><th>Slot</th><th>Portions</th></tr></thead><tbody>
${site.lines.map(line => `<tr><td>${html(line.name)}</td><td>${html(line.slot)}</td><td>${html(line.portions)}</td></tr>`).join("")}</tbody></table></section>`).join("")}</html>`;
  return { source, title, details, runSheetHtml };
}

type Group = { label: string; address: string; instructions?: string; lines: Array<{ name: string; portions: number; slot: string }> };
function addAllocations(groups: Map<string, Group>, day: PublishedMenuDay, oplocs?: ReadonlyMap<string, MirrorOploc>) {
  for (const entry of day.entries) for (const allocation of entry.allocations) {
    const target = allocation.destination;
    const sourceId = target?.id || allocation.destinationId;
    const governed = sourceId && target?.kind !== "one-off" ? oplocs?.get(sourceId) : undefined;
    if (oplocs && target?.kind !== "one-off" && !governed) throw new Error("The governed destination could not be verified.");
    const id = governed?.canonicalId || sourceId;
    if (!id || !entry.dishName.trim() || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0)
      throw new Error("A published allocation lacks stable identity, dish or portions.");
    if (target?.kind === "one-off") assertOneOffMenuDestination(target, day.sourceDayId);
    const address = target?.kind === "one-off" ? target.address : allocation.destinationAddress || governed?.address;
    const label = governed?.label || target?.label || allocation.destinationLabel;
    if (!label?.trim() || !address?.trim() || (target?.kind === "governed" && allocation.destinationId !== target.id))
      throw new Error("A published destination needs its authoritative address and matching OPLOC identity.");
    const existing = groups.get(id);
    if (existing && (existing.address !== address || existing.label !== label)) throw new Error("Published destination identity has conflicting addresses or labels.");
    const group = existing || { label, address, ...(target?.kind === "one-off" && target.deliveryInstructions ? { instructions: target.deliveryInstructions } : {}), lines: [] };
    group.lines.push({ name: entry.dishName, portions: allocation.quantity, slot: entry.slot });
    groups.set(id, group);
  }
}
