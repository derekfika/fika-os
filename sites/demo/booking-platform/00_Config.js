const SITE_CONFIG = Object.freeze({
  siteId: "demo",
  siteName: "FIKA Hospitality",
  address: "FIKA Hospitality",
  clientFacingName: "FIKA Hospitality",
  currency: "GBP",
  locale: "en-GB",
  timeZone: "Europe/London",
  bookingReferencePrefix: "DEMO",
  siteEmailAddress: "derek@fikacatering.com",
  notificationRecipients: [],
  feedback: {
    enabled: true,
    recipient: "derek@fikacatering.com",
    webAppUrl: "https://script.google.com/macros/s/AKfycbxt3mSCTPMyXGi4VfZGHo2rwWsI7afe_AZfoifSH10MtDQYiRfCsWwqDQwAvPzU2SjE/exec"
  },
   integration: {
    mode: "direct_dashboard",
    bookingSpreadsheetId: "1eLTPmE2TGAGZ_uDk9a3TcELK_mXeS4BJqMYQf-LSe74",
    dashboardSpreadsheetId: "1YwoWOifOYIT35aZbAdxGxXVGRsrvRBPuJkPQNkuj3Ow",
    spreadsheetId: "1eLTPmE2TGAGZ_uDk9a3TcELK_mXeS4BJqMYQf-LSe74",
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
    eyebrow: "FIKA hospitality",
    heroTitle: "A fresh way to book hospitality.",
    heroBody: "Plan breakfast, lunch, afternoon food, drinks and events in one clear request.",
    fikaLogoSvg: "",
    fikaLogoUrl: "https://fikacatering.com/assets/fika_logoRGB.png",
    fikaLogoAlt: "FIKA",
    fikaFallbackText: "Fika",
    siteLogoSvg: "",
    siteLogoUrl: "",
    siteLogoAlt: "FIKA Hospitality",
    siteFallbackText: "Hospitality",
    accent: "#4F34C7",
    ink: "#280F8C",
    paper: "#F4F3FF"
  }
});

const PLATFORM_SETTINGS_SCHEMA = Object.freeze([
  { key: "PRIMARY_LOGO_URL", fallback: SITE_CONFIG.branding.fikaLogoUrl },
  { key: "PRIMARY_LOGO_SVG", fallback: SITE_CONFIG.branding.fikaLogoSvg },
  { key: "PRIMARY_LOGO_ALT", fallback: SITE_CONFIG.branding.fikaLogoAlt },
  { key: "PRIMARY_FALLBACK_TEXT", fallback: SITE_CONFIG.branding.fikaFallbackText },
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
  { key: "DASHBOARD_URL", fallback: "" },
  { key: "FEEDBACK_WEB_APP_URL", fallback: SITE_CONFIG.feedback.webAppUrl },
  { key: "DEMO_FEEDBACK_RECIPIENT", fallback: SITE_CONFIG.feedback.recipient }
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
      fikaLogoSvg: settings.PRIMARY_LOGO_SVG,
      fikaLogoUrl: settings.PRIMARY_LOGO_URL,
      fikaLogoAlt: settings.PRIMARY_LOGO_ALT,
      fikaFallbackText: settings.PRIMARY_FALLBACK_TEXT,
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
      const value = String(row[1] || "").trim();
      if (Object.prototype.hasOwnProperty.call(values, key) && value) {
        values[key] = normaliseLegacyPlatformSetting_(key, value);
      }
    });
  } catch (error) {
    console.warn("Platform Settings could not be read: " + error.message);
  }

  return values;
}

function normaliseLegacyPlatformSetting_(key, value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();

  if (key === "SITE_EMAIL_ADDRESS" && lower === "demo@example.com") return SITE_CONFIG.siteEmailAddress;
  if (key === "PRIMARY_LOGO_URL" && !text) return SITE_CONFIG.branding.fikaLogoUrl;
  if (key === "PRIMARY_LOGO_ALT" && lower.indexOf("demo") > -1) return SITE_CONFIG.branding.fikaLogoAlt;
  if (key === "PRIMARY_FALLBACK_TEXT" && (lower === "hospitality" || lower.indexOf("demo") > -1)) return SITE_CONFIG.branding.fikaFallbackText;
  if (key === "SITE_LOGO_ALT" && (lower.indexOf("your logo") > -1 || lower.indexOf("demo") > -1)) return SITE_CONFIG.branding.siteLogoAlt;
  const legacyLogoPlaceholder = ["YOUR", "LOGO", "HERE"].join(" ");
  if (key === "SITE_FALLBACK_TEXT" && (upper === legacyLogoPlaceholder || lower.indexOf("demo") > -1)) return SITE_CONFIG.branding.siteFallbackText;
  if (key === "CLIENT_FACING_NAME" && lower.indexOf("demo") > -1) return SITE_CONFIG.clientFacingName;
  if (key === "BRAND_EYEBROW" && lower.indexOf("demo") > -1) return SITE_CONFIG.branding.eyebrow;
  if (key === "HERO_TITLE" && lower === "hospitality, simply arranged.") return SITE_CONFIG.branding.heroTitle;
  if (key === "COLOUR_ACCENT" && upper === "#4F5D64") return SITE_CONFIG.branding.accent;
  if (key === "COLOUR_INK" && upper === "#243036") return SITE_CONFIG.branding.ink;
  if (key === "COLOUR_PAPER" && upper === "#F4F3EF") return SITE_CONFIG.branding.paper;

  return text;
}
