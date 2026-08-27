import { CANONICAL_ALLERGEN_COLUMNS } from "@fika/contracts";

export type PublishedMatrixDay = {
  dayName: string;
  date: string;
  version: number;
  contentHash: string;
  entries: Array<{ slot: string; dishName: string; allergens: Record<string, string>; mayContainNotes?: string }>;
  allergenSignoff?: {
    productionChef?: { printedName: string; signatureDataUrl?: string; signedAt: string };
    headChefSiteManager?: { printedName: string; signatureDataUrl?: string; signedAt: string };
  };
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
const signature = (label: string, value?: { printedName: string; signatureDataUrl?: string; signedAt: string }) => value ? `<div class="signature"><strong>${label}</strong>${value.signatureDataUrl ? `<img src="${escapeHtml(value.signatureDataUrl)}" alt="${escapeHtml(label)} signature">` : ""}<span>${escapeHtml(value.printedName)}</span><small>${escapeHtml(new Date(value.signedAt).toLocaleString("en-GB"))}</small></div>` : "";

export function publishedAllergenMatrixHtml(day: PublishedMatrixDay) {
  const headers = CANONICAL_ALLERGEN_COLUMNS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const rows = day.entries.map(entry => `<tr><th>${escapeHtml(entry.slot)} · ${escapeHtml(entry.dishName)}</th>${CANONICAL_ALLERGEN_COLUMNS.map(([key]) => `<td class="${entry.allergens[key] || "clear"}">${entry.allergens[key] === "may_contain" ? "MC" : ""}</td>`).join("")}<td class="notes">${escapeHtml(entry.mayContainNotes || "—")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>FIKA Delivered-In ${escapeHtml(day.dayName)} allergen matrix</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;padding:0 6mm;font-family:Arial,sans-serif;color:#24115c;font-size:10px}.masthead{border-bottom:4px solid #4fb7c4;padding:3px 0 7px;display:flex;justify-content:space-between;align-items:center}.masthead h1{margin:0;color:#5135c9;font-size:27px}.meta{display:flex;gap:24px;padding:8px 0;font-size:10px;font-weight:700}.matrix{width:100%;border-collapse:collapse;table-layout:fixed}.matrix th,.matrix td{border:1px solid #16122c;text-align:center;height:26px;font-size:8px}.matrix thead th{height:48px;padding:3px;background:#5135c9;color:#fff;font-size:8px;line-height:1.05}.matrix thead th:first-child{width:24%;text-align:left;padding-left:7px}.matrix thead th:last-child{width:19%;font-size:7px}.matrix tbody th{text-align:left;padding:4px 7px;font-size:9px}.matrix td.contains{background:#000;color:#fff;font-size:15px}.matrix td.may_contain{background:#fff;color:#111;font-weight:800}.matrix td.notes{color:#d41424;font-size:7px;line-height:1.1}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}.signature{border:1px solid #16122c;padding:6px;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;min-height:42px}.signature strong{grid-column:1/-1;color:#5135c9}.signature img{max-width:100%;height:24px;object-fit:contain}.signature span,.signature small{display:block}.footer{margin-top:8px;font-size:8px;font-weight:700}</style></head><body><header class="masthead"><h1>FIKA · ALLERGEN CHECKER</h1><strong>DELIVERED-IN MENU</strong></header><div class="meta"><span>Service date: ${escapeHtml(day.date)}</span><span>Publication day version: v${day.version}</span><span>Day content hash: ${escapeHtml(day.contentHash)}</span></div><table class="matrix"><thead><tr><th>Dish / slot</th>${headers}<th>May-contain notes</th></tr></thead><tbody>${rows}</tbody></table><section class="signatures">${signature("Production Chef", day.allergenSignoff?.productionChef)}${signature("Head Chef / Site Manager", day.allergenSignoff?.headChefSiteManager)}</section><footer class="footer">Published record · Service date ${escapeHtml(day.date)} · Version v${day.version}</footer></body></html>`;
}
