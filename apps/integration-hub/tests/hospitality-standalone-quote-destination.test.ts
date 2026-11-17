import assert from "node:assert/strict";
import test from "node:test";
import { defaultDashboardQuoteSettings } from "../lib/quote-engine";
import { stagingStandaloneQuoteDestination } from "../lib/hospitality-standalone-quote-destination";

const rcoaBooking = { service: { portalSiteId: "rcoa", oplocId: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2" } };
const settings = { ...defaultDashboardQuoteSettings("rcoa-hospitality"), googleQuoteFolderId: "production-rcoa-quotes" };

test("standalone RCoA quote saving selects the isolated staging Quotes child before Drive ancestry verification", () => {
  const resolved = stagingStandaloneQuoteDestination(rcoaBooking, settings, {
    FIKA_RUNTIME_MODE: "staging",
    FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "1ba16ycYD2KcGPyRlNhb55NQvvXEh_enG",
  });
  assert.equal(resolved.googleQuoteFolderId, "1ba16ycYD2KcGPyRlNhb55NQvvXEh_enG");
});

test("staging RCoA quote saving fails closed instead of falling back to a persisted production folder", () => {
  assert.throws(
    () => stagingStandaloneQuoteDestination(rcoaBooking, settings, { FIKA_RUNTIME_MODE: "staging" }),
    /isolated staging RCoA quote destination is not configured/,
  );
});

test("other sites and production retain their existing quote destinations", () => {
  assert.equal(
    stagingStandaloneQuoteDestination({ service: { portalSiteId: "mnk", oplocId: "oploc:other" } }, settings, {
      FIKA_RUNTIME_MODE: "staging",
      FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "staging-rcoa-quotes",
    }).googleQuoteFolderId,
    "production-rcoa-quotes",
  );
  assert.equal(stagingStandaloneQuoteDestination({ service: { portalSiteId: "rcoa", oplocId: "oploc:alias" } }, settings, {
    FIKA_RUNTIME_MODE: "staging",
    FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "staging-rcoa-quotes",
  }).googleQuoteFolderId, "production-rcoa-quotes");
  assert.equal(
    stagingStandaloneQuoteDestination(rcoaBooking, settings, {
      FIKA_RUNTIME_MODE: "production",
      FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "staging-rcoa-quotes",
    }).googleQuoteFolderId,
    "production-rcoa-quotes",
  );
});
