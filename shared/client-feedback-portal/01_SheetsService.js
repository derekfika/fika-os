const FEEDBACK_REQUEST_HEADERS = [
  "Feedback Token", "Booking Reference", "Client Email", "Client Name",
  "Event Date", "Event Type", "Request Due", "Request Sent", "Request Sent Date",
  "Opened", "Opened Date", "Completed", "Completed Date", "Booking Snapshot JSON",
  "Site ID"
];

const FEEDBACK_RESPONSE_HEADERS = [
  "Feedback ID", "Booking Reference", "Submitted At", "Overall Satisfaction",
  "Food Quality", "Presentation", "Delivery Timing", "Ease Of Booking", "NPS",
  "What Went Well", "Improvements", "Additional Comments", "Contact Requested",
  "Preferred Contact Details", "Feedback JSON", "Site ID"
];

const FEEDBACK_ITEM_HEADERS = [
  "Feedback ID", "Booking Reference", "Item ID", "Item Name", "Quantity",
  "Rating", "Comments", "Site ID"
];

const FEEDBACK_SETTINGS_ROWS = [
  ["FEEDBACK_WEB_APP_URL", "", "Portal", "Feedback web-app URL", "The single shared feedback portal /exec URL."],
  ["SITE_EMAIL_ADDRESS", "seven@fikacatering.com", "Notifications", "Site manager inbox", "Primary inbox for low-rating follow-up."],
  ["FOLLOW_UP_RECIPIENTS", "", "Notifications", "Additional follow-up recipients", "Comma, semicolon or line-separated addresses."],
  ["FIKA_LOGO_URL", "", "Branding", "FIKA logo URL", "Direct HTTPS image URL."],
  ["SITE_LOGO_URL", "", "Branding", "Site logo URL", "Direct HTTPS image URL."],
  ["FIKA_FALLBACK_TEXT", "Fika", "Branding", "FIKA fallback text", "Used if the image is unavailable."],
  ["SITE_FALLBACK_TEXT", "", "Branding", "Site fallback text", "Defaults to the registered site name."],
  ["COLOUR_ACCENT", "#3d21bf", "Branding", "Accent colour", "Hex colour."],
  ["COLOUR_INK", "#221874", "Branding", "Text colour", "Hex colour."],
  ["COLOUR_PAPER", "#f4f4f2", "Branding", "Background colour", "Hex colour."]
];

function setupFeedbackPortal(siteId) {
  const contexts = siteId
    ? [getFeedbackSiteContext_(siteId)]
    : getFeedbackSiteContexts_();
  if (!contexts.length) {
    throw new Error("No feedback sites are configured in Script Properties.");
  }
  const results = contexts.map(setupFeedbackSite_);
  return { ok: true, sites: results };
}

function setupDemoFeedbackPortal() {
  return setupFeedbackPortal("demo");
}

function setupMnkFeedbackPortal() {
  return setupFeedbackPortal("mnk");
}

function setupAngelCourtFeedbackPortal() {
  return setupFeedbackPortal("angel_court");
}

function setupAllFeedbackPortals() {
  return setupFeedbackPortal();
}

function setupFeedbackSite_(context) {
  const spreadsheet = context.spreadsheet;
  const site = context.site;
  setupFeedbackSheet_(spreadsheet, FEEDBACK_CONFIG.sheets.requests, FEEDBACK_REQUEST_HEADERS);
  setupFeedbackSheet_(spreadsheet, FEEDBACK_CONFIG.sheets.responses, FEEDBACK_RESPONSE_HEADERS);
  setupFeedbackSheet_(spreadsheet, FEEDBACK_CONFIG.sheets.itemRatings, FEEDBACK_ITEM_HEADERS);
  setupFeedbackSettingsSheet_(spreadsheet, site);
  if (!spreadsheet.getSheetByName(site.dashboardSheetName)) {
    throw new Error(
      site.siteName + ": dashboard sheet '" + site.dashboardSheetName + "' was not found."
    );
  }
  return {
    siteId: site.siteId,
    siteName: site.siteName,
    spreadsheetName: spreadsheet.getName()
  };
}

function setupFeedbackSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0].map(String);
    const missing = headers.filter(function(header) {
      return existing.indexOf(header) === -1;
    });
    if (missing.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length)
        .setValues([missing]);
    }
  }
  sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .setFontWeight("bold")
    .setBackground("#3d21bf")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  return sheet;
}

function setupFeedbackSettingsSheet_(spreadsheet, site) {
  const name = FEEDBACK_CONFIG.sheets.settings;
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 5)
      .setValues([["Key", "Value", "Section", "Label", "Notes"]]);
  }
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getDisplayValues().map(function(row) { return row[0]; })
    : [];
  const missing = FEEDBACK_SETTINGS_ROWS.filter(function(row) {
    return existing.indexOf(row[0]) === -1;
  }).map(function(row) {
    const copy = row.slice();
    if (copy[0] === "SITE_EMAIL_ADDRESS") copy[1] = site.siteEmailAddress || copy[1];
    if (copy[0] === "SITE_FALLBACK_TEXT") copy[1] = site.siteFallbackText || site.siteName;
    return copy;
  });
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 5).setValues(missing);
  }
  sheet.getRange(1, 1, 1, 5)
    .setFontWeight("bold").setBackground("#3d21bf").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 360);
  sheet.setColumnWidth(5, 420);
  return sheet;
}

function setFeedbackSiteSpreadsheetId(siteId, value) {
  const site = getFeedbackSite_(siteId);
  const id = extractFeedbackSpreadsheetId_(value);
  if (!id) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  const spreadsheet = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty(site.spreadsheetPropertyKey, id);
  return {
    ok: true,
    siteId: site.siteId,
    spreadsheetId: id,
    spreadsheetName: spreadsheet.getName()
  };
}

function setFeedbackDashboardSpreadsheetId(value) {
  return setFeedbackSiteSpreadsheetId("angel_court", value);
}

function setFeedbackWebAppUrl(value, siteId) {
  const context = getFeedbackSiteContext_(siteId || "angel_court");
  const url = String(value || "").trim();
  if (!/^https:\/\/\S+\/exec(?:\?|$)/i.test(url)) {
    throw new Error("Paste the deployed feedback portal /exec URL.");
  }
  setupFeedbackSettingsSheet_(context.spreadsheet, context.site);
  setFeedbackSettingValue_(context.spreadsheet, "FEEDBACK_WEB_APP_URL", url);
  return {
    ok: true,
    siteId: context.site.siteId,
    setting: "FEEDBACK_WEB_APP_URL",
    value: url
  };
}

function getFeedbackSpreadsheet_(siteId) {
  return getFeedbackSiteContext_(siteId || "angel_court").spreadsheet;
}

function extractFeedbackSpreadsheetId_(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}

function feedbackHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const map = {};
  headers.forEach(function(header, index) {
    map[String(header).trim()] = index + 1;
  });
  return map;
}

function setFeedbackSettingValue_(spreadsheet, key, value) {
  const sheet = spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.settings);
  if (!sheet) throw new Error("Feedback Settings sheet was not found.");
  const cleanKey = String(key || "").trim();
  if (!cleanKey) throw new Error("Setting key is required.");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Feedback Settings has no setting rows.");
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < keys.length; index++) {
    if (String(keys[index][0] || "").trim() === cleanKey) {
      sheet.getRange(index + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([cleanKey, value, "", cleanKey, ""]);
}
