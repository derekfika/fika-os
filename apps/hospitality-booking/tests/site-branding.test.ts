import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hospitalitySiteThemeStyle,
  portalSite,
  portalSiteForAuthorisedOploc,
} from "../lib/portal-sites";

const booking = readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const referenceDataRoute = readFileSync(new URL("../app/api/reference-data/route.ts", import.meta.url), "utf8");
const menusRoute = readFileSync(new URL("../app/api/menus/route.ts", import.meta.url), "utf8");
const rcoaBookingRoute = readFileSync(new URL("../app/api/bookings/rcoa/route.ts", import.meta.url), "utf8");
const rcoaPage = readFileSync(new URL("../app/rcoa/page.tsx", import.meta.url), "utf8");
const rcoaPortal = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
const rcoaPortalStyles = readFileSync(new URL("../app/ui/RcoaBookingPortal.module.css", import.meta.url), "utf8");
const accessRoute = readFileSync(new URL("../app/api/access/route.ts", import.meta.url), "utf8");
const hubBridgeBookingRoute = readFileSync(new URL("../../integration-hub/app/api/bookings/mnk/route.ts", import.meta.url), "utf8");

test("site presentation is shared by Booking and Operations for every configured OPLOC", () => {
  for (const siteKey of ["mnk", "angel-court", "cfc", "munich-re"] as const) {
    const site = portalSite(siteKey);
    const authorised = portalSiteForAuthorisedOploc({ id: site.canonicalOplocId || `oploc:${siteKey}`, label: site.theme.shortLabel });
    assert.equal(authorised?.key, siteKey);
    assert.deepEqual(hospitalitySiteThemeStyle(site), {
      "--hospitality-site-hero-background": site.theme.heroBackground,
      "--hospitality-site-accent": site.theme.accent,
      "--hospitality-site-accent-soft": site.theme.accentSoft,
    });
  }
  assert.match(booking, /hospitalitySiteThemeStyle\(site\)/);
  assert.match(dashboard, /hospitalitySiteThemeStyle\(site\)/);
});

test("RCoA uses shared Hospitality theme/config and requires an exact configured OPLOC for manager access", () => {
  const site = portalSite("rcoa");
  const authorizedSite = { id: "oploc:rcoa-confirmed", label: "Royal College of Anaesthetists" };
  assert.equal(site.portalPath, "/rcoa");
  assert.equal(site.canonicalOplocId, undefined);
  assert.equal(portalSiteForAuthorisedOploc(authorizedSite), undefined);
  assert.equal(portalSiteForAuthorisedOploc(authorizedSite, { rcoa: "oploc:other" }), undefined);
  assert.equal(portalSiteForAuthorisedOploc(authorizedSite, { rcoa: "oploc:rcoa-confirmed" })?.key, "rcoa");
  assert.deepEqual(hospitalitySiteThemeStyle(site), {
    "--hospitality-site-hero-background": site.theme.heroBackground,
    "--hospitality-site-accent": site.theme.accent,
    "--hospitality-site-accent-soft": site.theme.accentSoft,
  });
  assert.match(dashboard, /site\.key/);
  assert.doesNotMatch(dashboard, /site\.key\s*===\s*["']rcoa["']/);
  assert.match(rcoaPage, /RcoaBookingPortal/);
  assert.match(accessRoute, /FIKA_RCOA_OPLOC_ID/);
  assert.match(rcoaBookingRoute, /buildTrustedRcoaHubPayload/);
  assert.match(rcoaBookingRoute, /hubFetch\("\/api\/bookings\/mnk"/);
  assert.match(rcoaBookingRoute, /x-fika-expected-rcoa-oploc-id/);
  assert.ok(hubBridgeBookingRoute.indexOf("requireBridgeAccess(request)") < hubBridgeBookingRoute.indexOf('request.headers.get("x-fika-expected-rcoa-oploc-id")'));
  assert.doesNotMatch(rcoaBookingRoute, /expectedOplocId\s*:\s*[^,}]+/);
  assert.match(rcoaPortal, /Booking<\/span><span>Breakfast<\/span><span>Lunch<\/span><span>Afternoon<\/span>/);
  assert.match(rcoaPortal, /Finger food<\/span><span>Bowl food &amp; canapes<\/span><span>Events/);
  assert.doesNotMatch(rcoaPortal, /Plan a booking with RCoA Hospitality/);
  assert.match(rcoaPortalStyles, /font-family: "Semplicita Pro"/);
  assert.match(rcoaPortalStyles, /min-height: 390px/);
  assert.match(rcoaPortalStyles, /grid-template-columns: 170px minmax\(0, 1fr\) 310px/);
  assert.match(rcoaPortalStyles, /\.stepActive\s*\{[^}]*background: transparent/s);
  assert.doesNotMatch(dashboard, /site\.key\s*===\s*["']rcoa["']/);
  assert.match(dashboard, /additionalChargesOpen/);
  assert.match(dashboard, /Additional charges/i);
  assert.match(dashboard, /Labour calculator/);
  assert.match(dashboard, /quoteNeedsRegeneration/);
  assert.match(dashboard, /PDF|Drive/);
  assert.match(dashboard, /Send to CPU|Production Order/);
});

test("Booking and Operations expose the canonical current site identity", () => {
  assert.match(booking, /currentSiteLabel/);
  assert.match(dashboard, /currentSiteLabel/);
  assert.match(dashboard, /<h1>\s*\{currentSiteLabel\},/s);
  assert.doesNotMatch(dashboard, /MNK operational workspace|portalSiteLabel \|\| "MNK"/);
});

test("surface entry is site-locked and offers Change workspace instead of an OPLOC selector", () => {
  assert.doesNotMatch(booking, /availableSites|onSiteChange|Hospitality site/);
  assert.doesNotMatch(dashboard, /availableSites|onSiteChange|Hospitality site/);
  assert.match(booking, /href="\/workspace"/);
  assert.match(dashboard, /href="\/workspace">Change workspace/);
});

test("unknown site keys and unrelated OPLOCs do not fall back to MNK", () => {
  assert.equal(portalSite("not-configured"), undefined);
  assert.equal(
    portalSiteForAuthorisedOploc({ id: "oploc:other", label: "Another authorised site" }),
    undefined,
  );
  assert.match(referenceDataRoute, /A configured Hospitality site context is required/);
  assert.doesNotMatch(referenceDataRoute, /searchParams\.get\("site"\)\s*\|\|\s*"mnk"/);
  assert.doesNotMatch(menusRoute, /portalSiteId\s*\|\|\s*"mnk"/);
});

test("CFC, Munich Re and Angel Court retain their own canonical display identities", () => {
  assert.equal(portalSiteForAuthorisedOploc({ id: "oploc:cfc", label: "CFC" })?.theme.shortLabel, "CFC");
  assert.equal(portalSiteForAuthorisedOploc({ id: "oploc:munich-re", label: "Munich RE" })?.theme.shortLabel, "Munich Re");
  assert.equal(portalSiteForAuthorisedOploc({ id: "oploc:angel-court", label: "Angel Court" })?.theme.shortLabel, "Angel Court");
});
