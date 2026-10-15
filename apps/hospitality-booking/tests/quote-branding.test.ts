import assert from "node:assert/strict";
import test from "node:test";
import { quoteHtml } from "../lib/quote-document";
import { HOSPITALITY_QUOTE_BRAND_CONFIG, renderHospitalityQuoteDocument, resolveQuoteBranding, type QuoteDocumentSnapshot } from "../../shared/hospitality-quote-document";
import { FIKA_LOGO_DATA_URI, SITE_LOGO_DATA_URIS } from "../../shared/hospitality-quote-brand-assets.generated";

const snapshot = (portalSiteId?: string, portalSiteLabel?: string): QuoteDocumentSnapshot => ({
  client: { companyName: "UAT", name: "Operator", email: "uat@example.test" },
  service: { portalSiteId, portalSiteLabel, eventDate: "2026-10-13", startTime: "12:00", guestCount: 12 },
  order: { lines: [{ name: "Sandwiches", quantity: 2, unitNet: { amount: 5 }, lineNet: { amount: 10 } }] }, charges: [], dietaries: {},
  totals: { itemsNet: { amount: 10 }, chargesNet: { amount: 0 }, net: { amount: 10 }, vat: { amount: 2 }, gross: { amount: 12 }, vatRate: 0.2 },
});
const render = (id?: string, label?: string) => renderHospitalityQuoteDocument(snapshot(id, label), { createdAt: "2026-10-06T12:00:00Z" });

test("FIKA logo is left of the site/client branding and FIKA OS never appears", () => {
  for (const id of Object.keys(HOSPITALITY_QUOTE_BRAND_CONFIG)) {
    const html = render(id, HOSPITALITY_QUOTE_BRAND_CONFIG[id].label);
    assert.doesNotMatch(html, /FIKA OS/);
    const fika = html.indexOf(`src="${FIKA_LOGO_DATA_URI}"`); const right = Math.max(html.indexOf('class="site-logo'), html.indexOf('class="masthead-label"'));
    assert.ok(fika > 0 && right > fika, `${id}: FIKA logo precedes site branding`);
  }
});

test("platform branding resolves deterministically from the booking's portal site", () => {
  assert.equal(resolveQuoteBranding({ portalSiteId: "mnk", portalSiteLabel: "MNK" }).logo, SITE_LOGO_DATA_URIS.mnk);
  assert.equal(resolveQuoteBranding({ portalSiteId: "mnk" }).reversedLogo, true);
  for (const id of ["angel-court", "cfc", "munich-re"]) assert.equal(resolveQuoteBranding({ portalSiteId: id }).logo, SITE_LOGO_DATA_URIS[id]);
  const rcoa = resolveQuoteBranding({ portalSiteId: "rcoa" });
  assert.equal(rcoa.label, "RCoA"); assert.equal(rcoa.logo, SITE_LOGO_DATA_URIS.rcoa); assert.match(rcoa.logo!, /^data:image\/svg\+xml;base64,/); assert.ok(rcoa.reversedLogo);
  const html = render("rcoa", "RCoA"); assert.ok(html.includes(`class="site-logo site-logo--reversed" src="${SITE_LOGO_DATA_URIS.rcoa}" alt="RCoA"`)); assert.doesNotMatch(html, /<div class="masthead-label"/);
  assert.ok(!render("rcoa").includes(SITE_LOGO_DATA_URIS.mnk));
});

test("missing optional branding falls back to a text label without breaking generation", () => {
  const unknown = render("not-a-site", "Somewhere"); assert.match(unknown, /masthead-label">Somewhere/); assert.ok(unknown.includes(FIKA_LOGO_DATA_URI));
  assert.match(render(undefined, undefined), /masthead-label">Hospitality/);
  assert.match(render("__proto__"), /masthead-label">Hospitality/);
});

test("grouped-body option keeps the canonical shell and totals but swaps the body", () => {
  const html = renderHospitalityQuoteDocument(snapshot("rcoa", "RCoA"), { createdAt: "2026-10-06T12:00:00Z" }, { bodyHtml: '<section class="schedule-service">X</section>', hideLocationAndGuests: true, vatLabel: "VAT (as recorded)" });
  assert.match(html, /schedule-service/); assert.doesNotMatch(html, /Your hospitality service|Guests<\/span>/);
  assert.equal((html.match(/Total to pay/g) || []).length, 1); assert.match(html, /VAT \(as recorded\)/);
});

test("ordinary single-service MNK quote still renders through the canonical document", () => {
  const html = quoteHtml({ quoteState: { currentRevisionId: "q", revisions: [{ id: "q", revision: 1, createdAt: "2026-10-06T12:00:00Z", snapshot: snapshot("mnk", "MNK") }] } } as never);
  assert.ok(html.includes(`class="site-logo site-logo--reversed" src="${SITE_LOGO_DATA_URIS.mnk}" alt="MNK"`)); assert.match(html, /Your hospitality service/); assert.match(html, /£12\.00/);
});
