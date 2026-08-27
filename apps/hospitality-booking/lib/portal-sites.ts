export type PortalSiteKey = "mnk" | "angel-court" | "cfc" | "munich-re";

export type PortalSiteConfig = {
  key: PortalSiteKey;
  label: string;
  displayName: string;
  logoPath: string;
  cssClass: string;
  bookingEndpoint: string;
  portalPath: string;
  oplocAliases: string[];
  canonicalOplocId?: string;
};

export const portalSites: Record<PortalSiteKey, PortalSiteConfig> = {
  mnk: {
    key: "mnk",
    label: "MNK",
    displayName: "MNK International",
    logoPath: "/brand/mnk/mnk-international-logo.png",
    cssClass: "site-mnk",
    bookingEndpoint: "/api/bookings/mnk",
    portalPath: "/mnk",
    oplocAliases: ["mnk", "funding circle"],
    canonicalOplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f",
  },
  "angel-court": {
    key: "angel-court",
    label: "Angel Court",
    displayName: "Angel Court Bank",
    logoPath: "/brand/angel-court/angel-court-bank-logo.png",
    cssClass: "site-angel-court",
    // Angel Court uses the existing typed booking contract; siteId scopes the record.
    bookingEndpoint: "/api/bookings/mnk",
    portalPath: "/angel-court",
    oplocAliases: ["angel court", "one angel court"],
  },
  cfc: {
    key: "cfc",
    label: "CFC",
    displayName: "CFC Underwriting",
    logoPath: "/brand/cfc/cfc-positive-logo.svg",
    cssClass: "site-cfc",
    bookingEndpoint: "/api/bookings/mnk",
    portalPath: "/cfc",
    oplocAliases: ["cfc"],
  },
  "munich-re": {
    key: "munich-re",
    label: "Munich Re",
    displayName: "Munich Re",
    logoPath: "/brand/munich-re/munich-re-logo.svg",
    cssClass: "site-munich-re",
    // The shared typed booking contract is scoped by siteId.
    bookingEndpoint: "/api/bookings/mnk",
    portalPath: "/munich-re",
    oplocAliases: ["munich re"],
  },
};

export function portalSite(key: string | undefined): PortalSiteConfig {
  return portalSites[
    key === "angel-court" || key === "cfc" || key === "munich-re" ? key : "mnk"
  ];
}

function normaliseSiteValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function portalSiteForOploc(site: { id: string; label: string }): PortalSiteConfig | undefined {
  const values = [site.id, site.label].map(normaliseSiteValue);
  return Object.values(portalSites).find((candidate) =>
    candidate.oplocAliases.some((alias) => values.includes(normaliseSiteValue(alias)))
  );
}
