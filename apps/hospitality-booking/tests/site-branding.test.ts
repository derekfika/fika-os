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
const startAgainButton = readFileSync(new URL("../app/ui/StartAgainButton.tsx", import.meta.url), "utf8");
const sharedPortalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const accessRoute = readFileSync(new URL("../app/api/access/route.ts", import.meta.url), "utf8");
const hubBridgeBookingRoute = readFileSync(new URL("../../integration-hub/app/api/bookings/mnk/route.ts", import.meta.url), "utf8");
const stagingConfig = readFileSync(new URL("../apphosting.staging.yaml", import.meta.url), "utf8");
const productionConfig = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");

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

test("RCoA manager identity uses the configured canonical OPLOC ID regardless of label", () => {
  const configuredId = "oploc:rcoa-confirmed";
  const configured = { rcoa: configuredId };
  assert.equal(
    portalSiteForAuthorisedOploc({ id: configuredId, label: "Jubilee House" }, configured)?.key,
    "rcoa",
  );
  assert.equal(
    portalSiteForAuthorisedOploc({ id: configuredId, label: "Some future renamed site" }, configured)?.key,
    "rcoa",
  );
  assert.equal(
    portalSiteForAuthorisedOploc(
      { id: "oploc:other", label: "Royal College of Anaesthetists" },
      configured,
    ),
    undefined,
  );
  assert.equal(
    portalSiteForAuthorisedOploc({ id: "oploc:other", label: "Royal College of Anaesthetists" }),
    undefined,
  );
});

test("Hospitality staging configures the approved RCoA OPLOC for server-side use", () => {
  const variable = stagingConfig.match(
    /  - variable: FIKA_RCOA_OPLOC_ID\r?\n([\s\S]*?)(?=\r?\n  - variable:|$)/,
  )?.[0];
  assert.ok(variable, "FIKA_RCOA_OPLOC_ID must be configured in staging");
  assert.match(variable, /value:\s*oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2/);
  assert.match(variable, /availability:\s*\[RUNTIME\]/);
  assert.doesNotMatch(variable, /BUILD/);
});

test("Hospitality production binds the approved RCoA OPLOC and carries no RCoA booking rollout flag", () => {
  assert.match(productionConfig, /variable: FIKA_RCOA_OPLOC_ID\r?\n\s+value: oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2\r?\n\s+availability: \[RUNTIME\]/);
  assert.doesNotMatch(productionConfig, /FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED/);
  assert.doesNotMatch(stagingConfig, /FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED/);
});

test("RCoA public page sends only configuration state and keeps the expected OPLOC server-side", () => {
  assert.match(rcoaPage, /configured=\{Boolean\(process\.env\.FIKA_RCOA_OPLOC_ID\?\.trim\(\)\)\}/);
  assert.doesNotMatch(rcoaPage, /\boplocId\b/);
  assert.match(rcoaPortal, /RcoaBookingPortal\(\{ configured \}: \{ configured: boolean \}\)/);
  assert.match(rcoaPortal, /disabled=\{sending \|\| !bookingId \|\| !rcoaConfigured\}/);
  assert.match(rcoaPortal, /const rcoaConfigured = configured/);
  assert.doesNotMatch(rcoaPortal, /\boplocId\b/);
  assert.match(rcoaBookingRoute, /const expectedOplocId = process\.env\.FIKA_RCOA_OPLOC_ID\?\.trim\(\)/);
  assert.match(rcoaBookingRoute, /["']x-fika-expected-rcoa-oploc-id["']:\s*expectedOplocId/);
  const groupRoute = readFileSync(new URL("../app/api/bookings/rcoa/group/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(rcoaBookingRoute + groupRoute + rcoaPortal, /SUBMISSIONS_ENABLED|SubmissionsEnabled|bookingSubmissionsEnabled|not yet open/);
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

test("booking portals are site-locked while workspace navigation remains on Operations", () => {
  assert.doesNotMatch(booking, /availableSites|onSiteChange|Hospitality site/);
  assert.doesNotMatch(dashboard, /availableSites|onSiteChange|Hospitality site/);
  assert.doesNotMatch(booking.match(/function Top\([\s\S]*?\n}\nfunction ResetModal/)?.[0] || "", /Change workspace|href="\/workspace"/);
  assert.match(dashboard, /href="\/workspace">Change workspace/);
});

test("every active booking platform uses the shared accessible refresh action", () => {
  const portalPages = [
    ["Angel Court", "../app/angel-court/page.tsx", /siteKey="angel-court"/],
    ["MNK", "../app/mnk/page.tsx", /siteKey="mnk"/],
    ["RCoA", "../app/rcoa/page.tsx", /RcoaBookingPortal/],
    ["CFC", "../app/cfc/page.tsx", /siteKey="cfc"/],
    ["Munich Re", "../app/munich-re/page.tsx", /siteKey="munich-re"/],
  ] as const;
  for (const [portal, path, expectedComponent] of portalPages) {
    const page = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(page, expectedComponent, `${portal} must keep its supported portal entry point`);
  }
  assert.match(booking, /<StartAgainButton className="start-again start-again--icon" onClick=\{onStartAgain\} \/>/);
  assert.match(rcoaPortal, /<StartAgainButton buttonRef=\{resetTriggerRef\} className=\{styles\.resetButton\} onClick=\{\(\) => setResetOpen\(true\)\} \/>/);
  assert.match(startAgainButton, /aria-label="Start again"/);
  assert.match(startAgainButton, /<RefreshCw aria-hidden="true"/);
  assert.match(sharedPortalStyles, /\.mnk-top-actions \.start-again--icon\{[^}]*width:44px;[^}]*height:44px/s);
  assert.match(rcoaPortalStyles, /\.resetButton\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
});

test("the start-again icon opens the existing confirmation and preserves draft and success handling", () => {
  assert.match(booking, /const \[resetOpen, setResetOpen\] = useState\(false\)/);
  assert.match(booking, /<StartAgainButton className="start-again start-again--icon" onClick=\{onStartAgain\} \/>/);
  assert.match(booking, /\{resetOpen && <ResetModal onCancel=\{\(\) => setResetOpen\(false\)\} onConfirm=\{resetBooking\} \/>\}/);
  assert.match(booking, /window\.localStorage\.removeItem\(draftKey\(site\.key\)\)/);
  assert.match(booking, /Make another request/);
  assert.match(rcoaPortal, /const \[resetOpen, setResetOpen\] = useState\(false\)/);
  assert.match(rcoaPortal, /onClick=\{\(\) => setResetOpen\(true\)\}/);
  assert.match(rcoaPortal, /\{resetOpen && <div className=\{styles\.modalBackdrop\}/);
  assert.match(rcoaPortal, /Clear this booking\?/);
});

test("effective minimum guest constraints are enforced alongside minimum quantities", () => {
  assert.match(booking, /function minimumGuestsFor\(items: PortalMenuItem\[\]\)/);
  assert.match(booking, /Selected items require at least \$\{minimumGuests\} guests\./);
  assert.match(booking, /minimumGuestsFor\(selected\.map\(\(value\) => value\.item\)\)/);
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
  assert.equal(portalSiteForAuthorisedOploc({ id: "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", label: "Angel Court" })?.theme.shortLabel, "Angel Court");
});
