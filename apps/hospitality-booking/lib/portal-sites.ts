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
  theme: HospitalitySiteTheme;
};

export type HospitalitySiteTheme = {
  shortLabel: string;
  heroBackground: string;
  accent: string;
  accentSoft: string;
  heroEyebrow: string;
};

export type HospitalitySiteThemeStyle = {
  "--hospitality-site-hero-background": string;
  "--hospitality-site-accent": string;
  "--hospitality-site-accent-soft": string;
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
    theme: {
      shortLabel: "MNK",
      heroBackground: "linear-gradient(114deg, #241176 0 58%, #4f35cf 58%)",
      accent: "#34e6e1",
      accentSoft: "#75efb8",
      heroEyebrow: "Hospitality workspace",
    },
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
    theme: {
      shortLabel: "Angel Court",
      heroBackground: "linear-gradient(116deg, #63666a 0 52%, #62baea 52%)",
      accent: "#f2dca7",
      accentSoft: "#b8dab3",
      heroEyebrow: "Hospitality workspace",
    },
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
    theme: {
      shortLabel: "CFC",
      heroBackground: "linear-gradient(114deg, #01416d 0 58%, #149bd7 58%)",
      accent: "#51c1f2",
      accentSoft: "#d7f0fb",
      heroEyebrow: "Hospitality workspace",
    },
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
    theme: {
      shortLabel: "Munich Re",
      heroBackground: "linear-gradient(114deg, #0f1e32 0 58%, #21377c 58%)",
      accent: "#1db1d9",
      accentSoft: "#bae7dc",
      heroEyebrow: "Hospitality workspace",
    },
  },
};

export function portalSite(key: PortalSiteKey): PortalSiteConfig;
export function portalSite(key: string | undefined): PortalSiteConfig | undefined;
export function portalSite(key: string | undefined): PortalSiteConfig | undefined {
  return key && Object.prototype.hasOwnProperty.call(portalSites, key)
    ? portalSites[key as PortalSiteKey]
    : undefined;
}

export function hospitalitySiteThemeStyle(site: PortalSiteConfig): HospitalitySiteThemeStyle {
  return {
    "--hospitality-site-hero-background": site.theme.heroBackground,
    "--hospitality-site-accent": site.theme.accent,
    "--hospitality-site-accent-soft": site.theme.accentSoft,
  };
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

/**
 * Resolve an OPLOC for the manager access list without treating a distinct
 * governed OPLOC as an alias for a portal with a configured canonical OPLOC.
 */
export function portalSiteForAuthorisedOploc(site: { id: string; label: string }): PortalSiteConfig | undefined {
  const portal = portalSiteForOploc(site);
  return portal?.canonicalOplocId && portal.canonicalOplocId !== site.id ? undefined : portal;
}

export type PortalWorkspaceSite = { id: string; portalSiteKey: PortalSiteKey };

export function preferredOplocForPortalSite(
  siteKey: string | undefined,
  sites: readonly PortalWorkspaceSite[],
): string | undefined {
  const portal = portalSite(siteKey);
  if (!portal) return undefined;
  return sites.find((site) => site.portalSiteKey === portal.key && portal.canonicalOplocId === site.id)?.id
    || sites.find((site) => site.portalSiteKey === portal.key)?.id;
}
