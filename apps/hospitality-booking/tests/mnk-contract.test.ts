import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { BookingInput } from "../lib/mnk-contract";
import { portalSite } from "../lib/portal-sites";
import { localAngelCourtMenuCatalogue } from "../lib/local-angel-court-menu";
import { localCfcMenuCatalogue } from "../lib/local-cfc-menu";
import { localMnkMenuCatalogue } from "../lib/local-mnk-menu";
import { localMunichReMenuCatalogue } from "../lib/local-munich-re-menu";
test("MNK journey retains the required contact, service and acknowledgement validation", () => { const value = BookingInput.safeParse({ clientName: "Host", clientEmail: "host@example.com", clientPhone: "1", companyName: "Client", eventDate: "2026-08-01", startTime: "12:00", guestCount: 5, roomOrArea: "Boardroom", eventType: "lunch", acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } }); assert.equal(value.success, true); });
test("MNK journey rejects a request without service location context", () => { const value = BookingInput.safeParse({ clientName: "Host", clientEmail: "host@example.com", clientPhone: "1", companyName: "Client", eventDate: "2026-08-01", startTime: "12:00", guestCount: 5, eventType: "lunch", acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } }); assert.equal(value.success, false); });
test("MNK portal has a dedicated route while preserving the legacy root entry point", () => {
  const route = fs.readFileSync(new URL("../app/mnk/page.tsx", import.meta.url), "utf8");
  const root = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(new URL("../app/mnk/dashboard/page.tsx", import.meta.url), "utf8");
  const dashboardCompat = fs.readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(route, /BookingPortal/);
  assert.match(root, /redirect\("\/mnk"\)/);
  assert.match(dashboard, /HospitalityDashboard/);
  assert.match(dashboardCompat, /redirect\("\/mnk\/dashboard"\)/);
});

test("MNK portal uses the locally retained official brand asset", () => {
  const site = portalSite("mnk");
  assert.equal(site.logoPath, "/brand/mnk/mnk-international-logo.png");
  assert.equal(fs.existsSync(new URL("../public/brand/mnk/mnk-international-logo.png", import.meta.url)), true);
});

test("Angel Court has a separate site route configuration and uses the guidelines logo", () => {
  const route = fs.readFileSync(new URL("../app/angel-court/page.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(new URL("../app/angel-court/dashboard/page.tsx", import.meta.url), "utf8");
  const site = portalSite("angel-court");
  assert.match(route, /siteKey="angel-court"/);
  assert.match(dashboard, /siteKey="angel-court"/);
  assert.equal(site.logoPath, "/brand/angel-court/angel-court-bank-logo.png");
  assert.equal(fs.existsSync(new URL("../public/brand/angel-court/angel-court-bank-logo.png", import.meta.url)), true);
});

test("Angel Court menu fixture retains brochure content without inventing allergen data", () => {
  assert.ok(localAngelCourtMenuCatalogue.items.length >= 20);
  assert.ok(localAngelCourtMenuCatalogue.items.some((item) => item.name === "Classic Working Lunch"));
  assert.equal(
    localAngelCourtMenuCatalogue.items.find((item) => item.name === "Exotic Fruit Box")?.description,
    "Watermelon, cantaloupe melon, honeydew melon, pineapple, kiwi, passion fruit and strawberries.",
  );
  assert.equal(
    localAngelCourtMenuCatalogue.items.find((item) => item.name === "Mini traybake bites")?.description,
    "Brownie, brookies, caramel shortbread and blondies.",
  );
  assert.ok(localAngelCourtMenuCatalogue.items.every((item) => item.dietaryInformation.length === 0 && item.allergenInformation.length === 0));
  assert.equal(localAngelCourtMenuCatalogue.source.path, "New Brochure Angel Court_Hospitality_2026.pptx");
});

test("CFC has a separate branded route and brochure-derived menu fixture", () => {
  const route = fs.readFileSync(new URL("../app/cfc/page.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(new URL("../app/cfc/dashboard/page.tsx", import.meta.url), "utf8");
  const site = portalSite("cfc");
  assert.match(route, /siteKey="cfc"/);
  assert.match(dashboard, /siteKey="cfc"/);
  assert.equal(site.logoPath, "/brand/cfc/cfc-positive-logo.svg");
  assert.equal(fs.existsSync(new URL("../public/brand/cfc/cfc-positive-logo.svg", import.meta.url)), true);
  assert.ok(localCfcMenuCatalogue.items.length >= 30);
  assert.ok(localCfcMenuCatalogue.items.some((item) => item.name === "Deli Style Sandwich Lunch"));
  assert.ok(localCfcMenuCatalogue.items.every((item) => item.dietaryInformation.length === 0 && item.allergenInformation.length === 0));
});

test("Munich Re has a separate portal, dashboard and generic brochure menu fixture", () => {
  const route = fs.readFileSync(new URL("../app/munich-re/page.tsx", import.meta.url), "utf8");
  const dashboard = fs.readFileSync(new URL("../app/munich-re/dashboard/page.tsx", import.meta.url), "utf8");
  const site = portalSite("munich-re");
  assert.match(route, /siteKey="munich-re"/);
  assert.match(dashboard, /siteKey="munich-re"/);
  assert.equal(site.logoPath, "/brand/munich-re/munich-re-logo.svg");
  assert.equal(fs.existsSync(new URL("../public/brand/munich-re/munich-re-logo.svg", import.meta.url)), true);
  assert.ok(localMunichReMenuCatalogue.items.length >= 30);
  assert.ok(localMunichReMenuCatalogue.items.some((item) => item.name === "Deli Style Sandwich Lunch"));
  assert.equal(localMunichReMenuCatalogue.source.path, "Fika Hospitality Brochure_2026.pptx");
  assert.ok(localMunichReMenuCatalogue.items.every((item) => item.dietaryInformation.length === 0 && item.allergenInformation.length === 0));
});

test("each branded portal exposes its own browser title", () => {
  const expected: Array<[string, string]> = [
    ["mnk", "MNK Hospitality"],
    ["angel-court", "Angel Court Hospitality"],
    ["cfc", "CFC Hospitality"],
    ["munich-re", "Munich Re Hospitality"],
  ];
  for (const [site, title] of expected) {
    const source = fs.readFileSync(new URL(`../app/${site}/layout.tsx`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`title: "${title}"`));
  }
});

test("every shared booking portal exposes a safe start-again workflow", () => {
  const portal = fs.readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /Start again/);
  assert.match(portal, /Clear and start again/);
  assert.match(portal, /setLines\(\[\]\)/);
  assert.match(portal, /setDetails\(\{/);
  assert.match(portal, /setContact\(\{/);
  assert.match(portal, /setDietaries\(\{/);
  assert.match(portal, /setAcks\(\{/);
  for (const route of ["mnk", "angel-court", "cfc", "munich-re"]) {
    const source = fs.readFileSync(new URL(`../app/${route}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /BookingPortal/);
  }
});

test("portal submission excludes option-only lines with no quantity", () => {
  const portal = fs.readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /\.filter\(\(value\) => value\.item && value\.quantity > 0\)/);
});

test("summer rolls require three boxes while retaining flavour choices across portal catalogues", () => {
  const mnk = localMnkMenuCatalogue.items.find((item) => item.name === "Freshly Wrapped Rice Paper Rolls");
  const cfc = localCfcMenuCatalogue.items.find((item) => item.name === "Freshly Wrapped Rice Paper Rolls");
  const angel = localAngelCourtMenuCatalogue.items.find((item) => item.source.sourceItemId === "wrapped");
  assert.equal(mnk?.orderingConstraints.minimumQuantity, 3);
  assert.equal(cfc?.orderingConstraints.minimumQuantity, 3);
  assert.equal(angel?.orderingConstraints.minimumQuantity, 3);
  assert.ok(mnk?.optionGroups.some((group) => group.id === "flavour"));
});

test("shared booking portal clamps summer rolls to the governed minimum", () => {
  const portal = fs.readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /Math\.max\(minimum, requested\)/);
  assert.match(portal, /requires at least \$\{minimum\}/);
  assert.match(portal, /Minimum \{item\.minimumQuantity\} boxes/);
});

test("Angel Court captures client identity and an optional invoice or PO reference", () => {
  const parsed = BookingInput.safeParse({
    requesterName: "Jordan Booker",
    requesterEmail: "jordan@example.com",
    requesterPhone: "020 1111 2222",
    requesterCompany: "Office Management Ltd",
    clientName: "Alex Morgan",
    clientEmail: "alex@example.com",
    clientPhone: "020 0000 0000",
    companyName: "Example Client",
    clientCompany: "Example Client Ltd",
    invoiceReference: "PO-AC-1042",
    eventDate: "2026-08-20",
    startTime: "12:00",
    guestCount: 10,
    roomOrArea: "Boardroom",
    eventType: "lunch",
    acknowledgements: {
      quoteSubjectToConfirmation: true,
      noticePolicyAccepted: true,
      dietaryResponsibilityAccepted: true,
    },
  });
  assert.equal(parsed.success, true);
  const portal = fs.readFileSync(
    new URL("../app/ui/BookingPortal.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(portal, /Your name/);
  assert.match(portal, /Client name/);
  assert.match(portal, /Client company/);
  assert.match(portal, /Invoice \/ PO reference/);
  assert.match(dashboard, /Invoice \/ PO reference/);
});
