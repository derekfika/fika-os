const DEFAULT_ANGEL_COURT_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 150" role="img" aria-label="Angel Court Bank"><text x="0" y="83" fill="#63666a" font-family="Avenir, Arial, sans-serif" font-size="86" font-weight="500" letter-spacing="-5">angelcourt</text><text x="157" y="134" fill="#63666a" font-family="Avenir, Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="10">BANK</text></svg>';

const SITE_CONFIG = Object.freeze({
  siteId: "angel_court",
  siteName: "Angel Court",
  address: "1 Angel Court, London",
  clientFacingName: "One Angel Court Hospitality",
  currency: "GBP",
  locale: "en-GB",
  timeZone: "Europe/London",
  bookingReferencePrefix: "AC",
  siteEmailAddress: "seven@fikacatering.com",
  notificationRecipients: [],
  integration: {
    mode: "direct_dashboard",
    spreadsheetId: "",
    dashboardSheetName: "Dashboard Data",
    managementFeeRate: 0.08,
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
    cancellationWindowHours: 72,
    largeEventNoticeWorkingDays: 10,
    dietaryNoticeWorkingDays: 3,
    blockMinimumOrderIssues: true
  },
  copy: {
    vatNote: "Estimated total, subject to final confirmation, VAT, labour and equipment hire where applicable.",
    requestAcknowledgement: "I understand this is a booking request and is subject to confirmation.",
    cancellationPolicy: {
      summaryTemplate: "Cancellations made within {hours} hours of the scheduled service time may incur a charge of up to 100% of the catering cost.",
      paragraphs: [
        "We understand that plans can change. If you need to cancel or significantly reduce your hospitality booking, please let the FIKA Hospitality team know as soon as possible.",
        "Cancellations made {hours} hours or more before the scheduled service time will normally not incur a cancellation charge.",
        "Cancellations made within {hours} hours of the scheduled service time may incur a charge of up to 100% of the catering cost. The amount charged will take into account food or products already ordered or prepared, committed supplier costs and other costs incurred in preparing your booking.",
        "Significant reductions to guest numbers or quantities within the {hours}-hour period may be treated as a partial cancellation and may also incur a charge.",
        "Where bespoke products, equipment or other third-party services have been ordered specifically for your booking and cannot be cancelled, those committed costs may still be chargeable.",
        "To cancel or amend a booking, please contact {contactEmail} quoting your booking reference."
      ],
      requestParagraphs: [
        "If you need to cancel or significantly reduce your booking, please let us know as soon as possible.",
        "Cancellations made within {hours} hours of the scheduled service time may incur a charge of up to 100% of the catering cost.",
        "To cancel or amend your request, contact {contactEmail} quoting your booking reference."
      ],
      confirmationParagraphs: [
        "If you need to change, cancel or significantly reduce your booking, please let us know as soon as possible.",
        "Cancellations made within {hours} hours of the scheduled service time may incur a charge of up to 100% of the catering cost.",
        "Significant reductions to guest numbers or quantities within that period may also be treated as a partial cancellation.",
        "To make a change or cancellation, contact {contactEmail} quoting your booking reference."
      ]
    }
  },
  branding: {
    eyebrow: "One Angel Court",
    heroTitle: "Hospitality at One Angel Court.",
    heroBody: "Plan breakfast, lunch, drinks and event service for your meeting or occasion.",
    siteLogoSvg: DEFAULT_ANGEL_COURT_LOGO_SVG,
    siteLogoUrl: "",
    siteLogoAlt: "Angel Court Bank",
    siteFallbackText: "Angel Court",
    accent: "#63666a",
    ink: "#323437",
    paper: "#f7f7f5"
  }
});

const PLATFORM_SETTINGS_SCHEMA = Object.freeze([
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
  { id: "breakfast", label: "Breakfast", categories: ["Breakfast"], noticeType: "standard" },
  { id: "lunch", label: "Lunch", categories: ["Lunch", "Lunch Add-ons", "Add-ons"], noticeType: "standard" },
  { id: "meeting_hospitality", label: "Meeting hospitality", categories: ["Breakfast", "Lunch", "Lunch Add-ons", "Drinks & Packages"], noticeType: "standard" },
  { id: "event_catering", label: "Event catering", categories: ["Events Catering", "Add-ons", "White Wine", "Red Wine", "Rosé Wine", "Sparkling Wine", "Drinks & Packages"], noticeType: "large" },
  { id: "drinks_reception", label: "Drinks reception", categories: ["White Wine", "Red Wine", "Rosé Wine", "Sparkling Wine", "Drinks & Packages", "Add-ons"], noticeType: "large" },
  { id: "bbq", label: "BBQ / large event", categories: ["Summer BBQ Catering", "White Wine", "Red Wine", "Rosé Wine", "Sparkling Wine", "Drinks & Packages"], noticeType: "large" },
  { id: "bespoke", label: "Bespoke enquiry", categories: [], noticeType: "large", allowsEmptyOrder: true }
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
      siteLogoSvg: settings.SITE_LOGO_SVG,
      siteLogoUrl: normaliseAngelCourtLogoUrl_(settings.SITE_LOGO_URL),
      siteLogoAlt: settings.SITE_LOGO_ALT,
      siteFallbackText: settings.SITE_FALLBACK_TEXT,
      accent: settings.COLOUR_ACCENT,
      ink: settings.COLOUR_INK,
      paper: settings.COLOUR_PAPER
    }),
    copy: Object.assign({}, SITE_CONFIG.copy, {
      cancellationPolicy: getCancellationPolicy_()
    })
  });
}

function formatCancellationPolicyCopy_(hours) {
  return formatCancellationPolicyText_(SITE_CONFIG.copy.cancellationPolicy.summaryTemplate, hours);
}

function getCancellationPolicy_() {
  const policy = SITE_CONFIG.copy.cancellationPolicy;
  const hours = SITE_CONFIG.rules.cancellationWindowHours;
  return {
    windowHours: hours,
    summary: formatCancellationPolicyCopy_(hours),
    paragraphs: policy.paragraphs.map(function(paragraph) {
      return formatCancellationPolicyText_(paragraph, hours);
    }),
    requestParagraphs: policy.requestParagraphs.map(function(paragraph) {
      return formatCancellationPolicyText_(paragraph, hours);
    }),
    confirmationParagraphs: policy.confirmationParagraphs.map(function(paragraph) {
      return formatCancellationPolicyText_(paragraph, hours);
    }),
    contactEmail: SITE_CONFIG.siteEmailAddress
  };
}

function formatCancellationPolicyText_(template, hours) {
  return String(template || "")
    .replace(/\{hours\}/g, String(hours))
    .replace(/\{contactEmail\}/g, SITE_CONFIG.siteEmailAddress);
}

function normaliseAngelCourtLogoUrl_(url) {
  const value = String(url || "").trim();
  if (/^https?:\/\/(www\.)?fikacatering\.com\/assets\/angel_court_logo\.png$/i.test(value)) {
    return "";
  }
  return value;
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
