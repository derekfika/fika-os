import type { InternalMatrixSignature, PlannedMenuItem } from "../lib/production-plan";
import { CANONICAL_ALLERGEN_COLUMNS } from "../../../shared/allergen-contract";

/** Keep this order aligned with the digital checker and the printed master sheet. */
export const matrixColumns = CANONICAL_ALLERGEN_COLUMNS;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
const mayContainNotes = (_allergens: Record<string, string>, notes?: string) => notes?.trim() || "";

export function allergenMatrixHtml(order: { clientName?: string; destinationLabel?: string; serviceType?: string; serviceDate?: string; serviceWindow?: { startTime: string; endTime?: string }; requiredBy: string }, menuItems: PlannedMenuItem[], signatures: InternalMatrixSignature[] = []) {
  const rows = menuItems.flatMap(item => item.subItems.map(sub => {
    const notes = mayContainNotes(sub.allergens, sub.mayContainNotes);
    return `<tr><th>${escapeHtml(sub.name || "Dish / food / product")}</th>${matrixColumns.map(([key]) => { const state = sub.allergens[key] || "clear"; return `<td class="${state}">${state === "contains" ? "✓" : state === "may_contain" ? "MC" : ""}</td>`; }).join("")}<td class="notes">${escapeHtml(notes)}</td></tr>`;
  })).join("");
  const serviceDate = order.serviceDate || order.requiredBy.slice(0, 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(serviceDate) ? new Date(`${serviceDate}T12:00:00`) : undefined;
  const serviceDay = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString("en-GB", { weekday: "long" }) : "";
  const weekCommencing = parsedDate && !Number.isNaN(parsedDate.getTime()) ? (() => { const monday = new Date(parsedDate); const offset = (monday.getDay() + 6) % 7; monday.setDate(monday.getDate() - offset); return monday.toISOString().slice(0, 10); })() : "";
  const serviceArea = order.destinationLabel || "Not assigned";
  const serviceType = order.serviceType || "Service type not recorded";
  const serviceTime = order.serviceWindow ? `${order.serviceWindow.startTime}${order.serviceWindow.endTime ? `–${order.serviceWindow.endTime}` : ""}` : "";
  const signature = (role: InternalMatrixSignature["role"]) => signatures.find(item => item.role === role);
  const signatureCell = (role: InternalMatrixSignature["role"]) => { const item = signature(role); return item ? `${item.signatureDataUrl ? `<img src="${escapeHtml(item.signatureDataUrl)}" alt="${escapeHtml(item.printedName)} signature" style="display:block;max-width:100%;height:22px;margin:0 auto 2px;object-fit:contain">` : ""}${escapeHtml(item.printedName)}<br><small>${escapeHtml(new Date(item.signedAt).toLocaleString("en-GB"))}</small>` : ""; };
  const dayRows = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => {
    const isServiceDay = day === serviceDay;
    return `<tr><th>${day}</th><td>${isServiceDay ? escapeHtml(serviceDate) : ""}</td><td>${isServiceDay ? signatureCell("production_chef") : ""}</td><td>${isServiceDay ? signatureCell("head_chef_site_manager") : ""}</td><td class="service-context">${isServiceDay ? `${escapeHtml(serviceArea)} · ${escapeHtml(serviceType)}${serviceTime ? ` · ${escapeHtml(serviceTime)}` : ""}` : ""}</td></tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Allergen checker</title><style>
@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{margin:0;padding:0 6mm;font-family:'Gilroy',Arial,sans-serif;color:#24115c;font-size:10px}@font-face{font-family:Gilroy;src:url('/fonts/Gilroy-Regular.ttf')}@font-face{font-family:Gilroy;src:url('/fonts/Gilroy-Bold.ttf');font-weight:800}
.masthead{display:grid;grid-template-columns:190px 1fr;align-items:center;border-bottom:4px solid #4fb7c4;padding:3px 0 7px}.logo{font-size:38px;font-weight:800;letter-spacing:-.08em;color:#5135c9}.masthead h1{margin:0;text-align:right;color:#5135c9;font-size:31px;letter-spacing:.02em}.instructions{margin:1px 0 0;text-align:right;font-size:8px;line-height:1.25;font-weight:800;color:#171238}.context{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:8px 0;font-size:11px;font-weight:800}.context span{display:block;color:#5135c9;font-size:8px;text-transform:uppercase;letter-spacing:.04em}.matrix{width:100%;border-collapse:collapse;table-layout:fixed}.matrix th,.matrix td{border:1px solid #16122c;text-align:center;height:26px;font-size:8px}.matrix thead th{height:48px;padding:3px;background:#5135c9;color:#fff;font-size:8px;line-height:1.05;vertical-align:middle}.matrix thead th:first-child{width:24%;text-align:left;padding-left:7px}.matrix thead th:last-child{width:19%;font-size:7px}.matrix tbody th{text-align:left;padding:4px 7px;font-size:9px}.matrix td.contains{background:#000;color:#fff;font-size:15px}.matrix td.may_contain{background:#fff;color:#111;font-weight:800}.matrix td.notes{color:#d41424;font-size:7px;line-height:1.1}.signoff{margin-top:9px;width:100%;border-collapse:collapse;table-layout:fixed}.signoff th,.signoff td{border:1px solid #16122c;height:18px;padding:3px;font-size:7px}.signoff thead th{background:#5135c9;color:#fff;font-weight:800}.signoff th:first-child{width:11%}.signoff th:nth-child(2){width:10%}.signoff th:nth-child(3),.signoff th:nth-child(4){width:22%}.signoff th:nth-child(5){width:35%}.signoff .day{text-align:left;font-weight:800}.verification{margin-top:10px;font-size:9px;font-weight:800}.footer{display:flex;justify-content:space-between;margin-top:8px;font-size:8px;font-weight:800}.tools{margin:10px 0;text-align:right}.tools button{border:0;border-radius:5px;background:#5135c9;color:#fff;padding:6px 10px;font-weight:800}@media print{.tools{display:none!important}}
</style></head><body><header class="masthead"><div class="logo">Fika</div><div><h1>ALLERGEN CHECKER</h1><p class="instructions">Clearly mark all allergens: white = none · black = contains · MC = may contain<br>List specific gluten and/or tree nut allergens in the final column.</p></div></header>
<div class="context"><div><span>Location / client</span>${escapeHtml(order.destinationLabel || order.clientName || "Not assigned")}</div><div><span>Service type</span>${escapeHtml(serviceType)}</div><div><span>Service date</span>${escapeHtml(serviceDate)}</div><div><span>Service area</span>${escapeHtml(serviceArea)}</div></div>
<table class="matrix"><thead><tr><th>Dish / food / product</th>${matrixColumns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}<th>Notes</th></tr></thead><tbody>${rows || `<tr><th colspan="${matrixColumns.length + 2}">No sub-items recorded.</th></tr>`}</tbody></table>
<table class="signoff"><thead><tr><th>Day</th><th>Date</th><th>Chef<br>Printed name / signature</th><th>Pre-service check<br>Head chef / site manager<br>Printed name / signature</th><th>Service area / service type / service time</th></tr></thead><tbody>${dayRows}</tbody></table>
<div class="verification">Week commencing date: <strong>${escapeHtml(weekCommencing || "To confirm")}</strong></div><footer class="footer"><span>FIKA OS · CPU Production</span><span>Generated ${escapeHtml(new Date().toLocaleDateString("en-GB"))}</span></footer><div class="tools"><button onclick="window.print()">Save / print matrix</button></div></body></html>`;
}

export { mayContainNotes };
