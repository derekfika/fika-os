const SITE_CONFIG = Object.freeze({
  siteId: "mnk",
  siteName: "MNK",
  address: "110 Bishopsgate, EC2N 4AY",
  clientFacingName: "Fika at MNK Hospitality",
  currency: "GBP",
  locale: "en-GB",
  timeZone: "Europe/London",
  bookingReferencePrefix: "MNK",
  siteEmailAddress: "mnk@fikacatering.com",
  notificationRecipients: [],
  integration: {
    mode: "direct_dashboard",
    bookingSpreadsheetId: "1eR9J1x7VDOYtLT572burlr_GPIi4JPFoqopRpuyFJkQ",
    dashboardSpreadsheetId: "1GIGIh_oAY0yLrrlXPaSvHte2oMPT8S_dKFAYdZN6nuc",
    spreadsheetId: "",
    dashboardSheetName: "Dashboard Data",
    managementFeeRate: 0,
    vatRate: 0.20,
    keepClientRequestLog: false
  },
  sheets: {
    bookingRequests: "Booking Requests",
    bookingLineItems: "Booking Line Items",
    menuItems: "Menu Items",
    settings: "Platform Settings"
  },
  rules: {
    standardNoticeHours: 72,
    largeEventNoticeWorkingDays: 7,
    dietaryNoticeWorkingDays: 3,
    blockMinimumOrderIssues: true
  },
  copy: {
    vatNote: "Indicative prices exclude VAT and are subject to confirmation, labour and hire equipment where applicable.",
    requestAcknowledgement: "I understand this is a booking request and is subject to confirmation."
  },
  branding: {
    eyebrow: "110 Bishopsgate hospitality brochure 2026",
    heroTitle: "Hospitality, Elevated.",
    heroBody: "Plan Fika at MNK hospitality across breakfast, lunch, afternoon food, canapes and events in one clear request.",
    fikaLogoSvg: "",
    fikaLogoUrl: "",
    fikaLogoAlt: "Fika at MNK",
    fikaFallbackText: "mnk",
    siteLogoSvg: "",
    siteLogoUrl: "",
    siteLogoAlt: "Fika",
    siteFallbackText: "Fika",
    accent: "#176f8e",
    ink: "#07506f",
    paper: "#eef8fb"
  }
});

const PLATFORM_SETTINGS_SCHEMA = Object.freeze([
  { key: "FIKA_LOGO_URL", fallback: SITE_CONFIG.branding.fikaLogoUrl },
  { key: "FIKA_LOGO_SVG", fallback: SITE_CONFIG.branding.fikaLogoSvg },
  { key: "FIKA_LOGO_ALT", fallback: SITE_CONFIG.branding.fikaLogoAlt },
  { key: "FIKA_FALLBACK_TEXT", fallback: SITE_CONFIG.branding.fikaFallbackText },
  { key: "SITE_LOGO_URL", fallback: SITE_CONFIG.branding.siteLogoUrl },
  { key: "SITE_LOGO_SVG", fallback: SITE_CONFIG.branding.siteLogoSvg },
  { key: "SITE_LOGO_ALT", fallback: SITE_CONFIG.branding.siteLogoAlt },
  { key: "SITE_FALLBACK_TEXT", fallback: SITE_CONFIG.branding.siteFallbackText },
  { key: "CLIENT_FACING_NAME", fallback: SITE_CONFIG.clientFacingName },
  { key: "BRAND_EYEBROW", fallback: SITE_CONFIG.branding.eyebrow },
  { key: "HERO_TITLE", fallback: SITE_CONFIG.branding.heroTitle },
  { key: "HERO_BODY", fallback: SITE_CONFIG.branding.heroBody },
  { key: "COLOUR_ACCENT", fallback: SITE_CONFIG.branding.accent },
  { key: "COLOUR_INK", fallback: SITE_CONFIG.branding.ink },
  { key: "COLOUR_PAPER", fallback: SITE_CONFIG.branding.paper },
  { key: "SITE_EMAIL_ADDRESS", fallback: SITE_CONFIG.siteEmailAddress },
  { key: "NOTIFICATION_RECIPIENTS", fallback: SITE_CONFIG.notificationRecipients.join(", ") },
  { key: "DASHBOARD_URL", fallback: "" }
]);

const EVENT_TYPES = Object.freeze([
  { id: "breakfast", label: "Breakfast", categories: ["Drinks", "Breakfast", "Sweet treats"], noticeType: "standard" },
  { id: "lunch", label: "Lunch", categories: ["Lunch", "Lunch Boxes", "Salads & Sushi", "Grazing Boxes", "Sweet treats"], noticeType: "standard" },
  { id: "afternoon", label: "Afternoon", categories: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"], noticeType: "standard" },
  { id: "meeting_hospitality", label: "Meeting hospitality", categories: ["Drinks", "Breakfast", "Lunch", "Lunch Boxes", "Salads & Sushi", "Sweet treats", "Afternoon"], noticeType: "standard" },
  { id: "finger_food", label: "Finger food", categories: ["Finger Food", "Grazing Boxes", "Sweet treats", "Drinks"], noticeType: "standard" },
  { id: "event_catering", label: "Bowl food & canapes", categories: ["Fork Buffet & Bowl Food", "Canapes", "Grazing Events", "Drinks"], noticeType: "large" },
  { id: "dining", label: "Dining", categories: ["Dining", "Drinks"], noticeType: "large" },
  { id: "bespoke", label: "Bespoke events", categories: ["Bespoke Events", "Grazing Events", "Dining"], noticeType: "large", allowsEmptyOrder: true }
]);

function getPublicPlatformConfig() {
  const settings = getPlatformSettings_();
  return {
    site: buildPublicSiteConfig_(settings),
    eventTypes: EVENT_TYPES,
    menu: MENU_SCHEMA.filter(function(item) { return item.available; })
  };
}

function buildPublicSiteConfig_(settings) {
  return Object.assign({}, SITE_CONFIG, {
    clientFacingName: settings.CLIENT_FACING_NAME,
    branding: Object.assign({}, SITE_CONFIG.branding, {
      eyebrow: settings.BRAND_EYEBROW,
      heroTitle: settings.HERO_TITLE,
      heroBody: settings.HERO_BODY,
      fikaLogoSvg: settings.FIKA_LOGO_SVG,
      fikaLogoUrl: settings.FIKA_LOGO_URL,
      fikaLogoAlt: settings.FIKA_LOGO_ALT,
      fikaFallbackText: settings.FIKA_FALLBACK_TEXT,
      siteLogoSvg: settings.SITE_LOGO_SVG,
      siteLogoUrl: settings.SITE_LOGO_URL,
      siteLogoAlt: settings.SITE_LOGO_ALT,
      siteFallbackText: settings.SITE_FALLBACK_TEXT,
      accent: settings.COLOUR_ACCENT,
      ink: settings.COLOUR_INK,
      paper: settings.COLOUR_PAPER
    })
  });
}

function getPlatformSettings_() {
  const values = {};
  PLATFORM_SETTINGS_SCHEMA.forEach(function(setting) { values[setting.key] = setting.fallback; });

  try {
    const spreadsheet = getBookingSpreadsheet_();
    const sheet = spreadsheet.getSheetByName(SITE_CONFIG.sheets.settings);
    if (!sheet || sheet.getLastRow() < 2) return values;

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
    rows.forEach(function(row) {
      const key = String(row[0] || "").trim();
      if (Object.prototype.hasOwnProperty.call(values, key) && String(row[1] || "").trim()) {
        values[key] = String(row[1]).trim();
      }
    });
  } catch (error) {
    console.warn("Platform Settings could not be read: " + error.message);
  }

  return values;
}
