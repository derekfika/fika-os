/**
 * Code-owned sender identities for modern Hospitality booking OPLOCs.
 * Runtime configuration may enable a lifecycle or select an explicitly approved
 * delegated mailbox, but it cannot change the site's From or Reply-To address.
 */
export const HOSPITALITY_EMAIL_SITE_IDENTITIES = Object.freeze({
  "oploc:0d8626f9-99bd-4dde-9471-191dd0abfb2e": Object.freeze({
    siteId: "cfc",
    from: "cfc@fikacatering.com",
    replyTo: "cfc@fikacatering.com",
    primaryMailbox: "cfc@fikacatering.com",
  }),
  "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f": Object.freeze({
    siteId: "mnk",
    from: "mnk@fikacatering.com",
    replyTo: "mnk@fikacatering.com",
    primaryMailbox: "mnk@fikacatering.com",
  }),
  "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10": Object.freeze({
    siteId: "angel-court",
    from: "seven@fikacatering.com",
    replyTo: "seven@fikacatering.com",
    primaryMailbox: "seven@fikacatering.com",
  }),
  "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2": Object.freeze({
    siteId: "rcoa",
    from: "rcoa@fikacatering.com",
    replyTo: "rcoa@fikacatering.com",
    primaryMailbox: "rcoa@fikacatering.com",
  }),
  "oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701": Object.freeze({
    siteId: "munich-re",
    from: "munichre@fikacatering.com",
    replyTo: "munichre@fikacatering.com",
    primaryMailbox: "munichre@fikacatering.com",
  }),
});

export const RCOA_HOSPITALITY_OPLOC_ID: HospitalityEmailOplocId = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
export type HospitalityEmailOplocId = keyof typeof HOSPITALITY_EMAIL_SITE_IDENTITIES;
export type HospitalityEmailSiteIdentity = (typeof HOSPITALITY_EMAIL_SITE_IDENTITIES)[HospitalityEmailOplocId];

type Env = Record<string, string | undefined>;
const address = (value: string) => /^[^\s<>@,;\r\n]+@fikacatering\.com$/i.test(value);

/**
 * Each OPLOC can delegate only as its own mailbox by default. A different
 * authenticated account (for a verified Send As identity) must be explicitly
 * added to the server-side OPLOC keyed allowlist. All subjects remain in-domain.
 */
export function authorizedHospitalityMailboxes(oplocId: string, env: Env = process.env): ReadonlySet<string> {
  const identity = HOSPITALITY_EMAIL_SITE_IDENTITIES[oplocId as HospitalityEmailOplocId];
  if (!identity) throw new Error("Booking OPLOC has no approved Workspace mail identity.");

  const raw = env.FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON;
  let configured: Record<string, unknown> = {};
  if (raw?.trim()) {
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      configured = value as Record<string, unknown>;
    } catch {
      throw new Error("Workspace mailbox allowlist is invalid.");
    }
  }

  for (const [siteOploc, accounts] of Object.entries(configured)) {
    if (!Object.hasOwn(HOSPITALITY_EMAIL_SITE_IDENTITIES, siteOploc) || !Array.isArray(accounts)
      || accounts.some(account => typeof account !== "string" || !address(account))) {
      throw new Error("Workspace mailbox allowlist is invalid.");
    }
  }

  const extra = configured[oplocId] as string[] | undefined;
  return new Set([identity.primaryMailbox, ...(extra || [])].map(value => value.trim().toLowerCase()));
}
