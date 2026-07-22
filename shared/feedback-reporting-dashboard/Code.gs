function doGet() {
  const template = HtmlService.createTemplateFromFile("Index");
  template.initialConfig = JSON.stringify(getFeedbackReportingConfig());
  return template.evaluate()
    .setTitle(FEEDBACK_REPORTING_CONFIG.appName)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Feedback Reporting")
    .addItem("Check site connections", "getFeedbackReportingHealth")
    .addToUi();
}

function getFeedbackReportingConfig() {
  return {
    appName: FEEDBACK_REPORTING_CONFIG.appName,
    sites: getConfiguredFeedbackSites_().map(function(site) {
      return { siteId: site.siteId, siteName: site.siteName, configured: Boolean(site.spreadsheetId) };
    }),
    serverDate: Utilities.formatDate(new Date(), FEEDBACK_REPORTING_CONFIG.timeZone, "yyyy-MM-dd")
  };
}

function setFeedbackReportingSiteSpreadsheetId(siteId, value) {
  const site = getFeedbackReportingSite_(siteId);
  if (!site.propertyKey) throw new Error("This site cannot be configured with a spreadsheet property.");
  const id = extractSpreadsheetId_(value);
  if (!id) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty(site.propertyKey, id);
  return getFeedbackReportingHealth();
}

function getFeedbackReportingHealth() {
  return getConfiguredFeedbackSites_()
    .filter(function(site) { return site.siteId !== "all"; })
    .map(getFeedbackReportingSiteHealth_);
}

function logFeedbackReportingHealth() {
  const health = getFeedbackReportingHealth();
  console.log(JSON.stringify(health, null, 2));
  Logger.log(JSON.stringify(health, null, 2));
  return health;
}

function getFeedbackReportingSiteHealth(siteId) {
  return getFeedbackReportingSiteHealth_(getConfiguredFeedbackSite_(siteId), true);
}

function logAngelCourtFeedbackReportingHealth() {
  const health = getFeedbackReportingSiteHealth("angel_court");
  console.log(JSON.stringify(health, null, 2));
  Logger.log(JSON.stringify(health, null, 2));
  return health;
}

function getFeedbackReportingSiteHealth_(site, includeTabs) {
  if (!site.spreadsheetId) {
    return { siteId: site.siteId, siteName: site.siteName, ok: false, message: "No spreadsheet configured." };
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(site.spreadsheetId);
    const hasRequests = Boolean(spreadsheet.getSheetByName(FEEDBACK_REPORTING_CONFIG.sheets.requests));
    const hasResponses = Boolean(spreadsheet.getSheetByName(FEEDBACK_REPORTING_CONFIG.sheets.responses));
    const hasItemRatings = Boolean(spreadsheet.getSheetByName(FEEDBACK_REPORTING_CONFIG.sheets.itemRatings));
    const ok = hasRequests || hasResponses || hasItemRatings;
    const result = {
      siteId: site.siteId,
      siteName: site.siteName,
      ok: ok,
      spreadsheetName: spreadsheet.getName(),
      spreadsheetId: spreadsheet.getId(),
      source: site.configSource || "config",
      hasRequests: hasRequests,
      hasResponses: hasResponses,
      hasItemRatings: hasItemRatings,
      message: ok
        ? "Connected."
        : "Spreadsheet opened, but feedback tabs were not found."
    };

    if (includeTabs && !ok) {
      result.tabs = spreadsheet.getSheets().map(function(sheet) {
        return sheet.getName();
      });
      result.message += " Available tabs: " + result.tabs.join(", ");
    }

    return result;
  } catch (error) {
    return { siteId: site.siteId, siteName: site.siteName, ok: false, message: error.message };
  }
}

function getConfiguredFeedbackSites_() {
  const properties = PropertiesService.getScriptProperties();
  return FEEDBACK_REPORTING_SITES.map(function(site) {
    const propertyId = site.propertyKey ? properties.getProperty(site.propertyKey) : "";
    const legacyPropertyId = site.spreadsheetId
      ? properties.getProperty(site.spreadsheetId)
      : "";
    const configuredId = propertyId || legacyPropertyId || site.spreadsheetId || "";
    return Object.assign({}, site, {
      spreadsheetId: configuredId,
      configSource: propertyId
        ? "script property " + site.propertyKey
        : legacyPropertyId
          ? "legacy script property"
          : configuredId
            ? "config"
            : ""
    });
  });
}

function clearFeedbackReportingSiteSpreadsheetOverride(siteId) {
  const site = getFeedbackReportingSite_(siteId);
  const properties = PropertiesService.getScriptProperties();
  if (site.propertyKey) properties.deleteProperty(site.propertyKey);
  if (site.spreadsheetId) properties.deleteProperty(site.spreadsheetId);
  return getFeedbackReportingHealth();
}

function getFeedbackReportingSite_(siteId) {
  const id = String(siteId || "").trim();
  const site = FEEDBACK_REPORTING_SITES.find(function(candidate) {
    return candidate.siteId === id;
  });
  if (!site) throw new Error("Unknown site: " + siteId);
  return site;
}

function getConfiguredFeedbackSite_(siteId) {
  const id = String(siteId || "").trim();
  const site = getConfiguredFeedbackSites_().find(function(candidate) {
    return candidate.siteId === id;
  });
  if (!site) throw new Error("Unknown site: " + siteId);
  return site;
}

function extractSpreadsheetId_(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach(function(header, index) {
    map[String(header).trim()] = index + 1;
  });
  return map;
}

function csvCell_(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function parseDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, FEEDBACK_REPORTING_CONFIG.timeZone, "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

function displayDate_(value) {
  const text = parseDate_(value);
  if (!text) return "";
  const parts = text.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function round_(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}
