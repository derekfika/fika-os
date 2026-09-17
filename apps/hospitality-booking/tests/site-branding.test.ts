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
