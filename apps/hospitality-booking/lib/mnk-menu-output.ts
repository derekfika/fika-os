import type { CanonicalBooking } from "@/lib/canonical-types";

export type MenuOutput = {
  id: string;
  fileName: string;
  bookingId: string;
  planId: string;
  planUpdatedAt: string;
  generatedAt: string;
  generatedBy: string;
  templateVersion: "mnk-hospitality-menu-v1" | "mnk-hospitality-menu-v2";
  google?: { fileId: string; presentationUrl: string; driveUrl: string };
  booking: { companyName: string; destination: string; date: string; time: string; guestCount: number };
  items: Array<{ menuItem: string; name: string; allergens: string[]; mayContain: string[] }>;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
export function menuFileName(booking: MenuOutput["booking"]) { return [booking.date, booking.time, booking.companyName, booking.destination].map(value => String(value).trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).join("-"); }

export function mnkMenuHtml(output: MenuOutput) {
  const items = output.items.map(item => `<section class="dish"><h2>${escapeHtml(item.name)}</h2>${item.allergens.length ? `<p class="allergens">(${escapeHtml(item.allergens.join(", "))})</p>` : ""}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(output.fileName)}</title><style>@font-face{font-family:Montserrat;src:local(Montserrat)}*{box-sizing:border-box}body{margin:0;background:#fff;color:#0f4c6a;font-family:Montserrat,Arial,sans-serif}.page{width:210mm;min-height:297mm;margin:auto;position:relative;padding:18mm 18mm 20mm;background:#fff}.top{height:12mm;background:#0f4c6a;color:#fff;display:flex;align-items:center;justify-content:flex-end;padding:0 8mm;font-weight:700;letter-spacing:.08em}.stripe{height:1.5mm;background:#49a5b5}.logo{position:absolute;top:25mm;left:18mm;font-size:24px;font-weight:800;letter-spacing:-.08em}.content{margin-top:42mm;text-align:center}.menu{margin:0 auto;max-width:150mm}.dish{padding:4mm 0 5mm;border-bottom:1px solid #d6e2e5}.dish h2{font-size:17px;line-height:1.25;margin:0 auto 2mm;font-weight:700}.allergens{color:#f00000;font-size:12px;line-height:1.35;margin:1mm 0 0}.footer{position:absolute;bottom:10mm;left:18mm;right:18mm;border-top:1px solid #d6e2e5;padding-top:4mm;font-size:10px;text-align:center}@media print{.page{margin:0;box-shadow:none}}@media screen{body{background:#e8edf0}.page{box-shadow:0 8px 32px #0f4c6a22;margin:20px auto}}</style></head><body><main class="page"><div class="top">MENU</div><div class="stripe"></div><div class="logo">mnk</div><div class="content"><div class="menu">${items || "<p>No menu items recorded.</p>"}</div></div><footer class="footer">Prepared for service</footer></main></body></html>`;
}

export function menuBookingContext(booking: CanonicalBooking) {
  return { companyName: booking.client.companyName, destination: booking.service.portalSiteLabel || booking.service.roomOrArea || booking.service.deliveryPoint || "Destination not assigned", date: booking.service.eventDate, time: booking.service.startTime, guestCount: booking.service.guestCount };
}
