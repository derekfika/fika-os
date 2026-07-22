function doGet() {
  const template = HtmlService.createTemplateFromFile("Index");
  template.initialConfig = JSON.stringify(getPublicAppConfig());
  return template.evaluate()
    .setTitle(HOT_DRINKS_CONFIG.appName)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Hot Drink Tally")
    .addItem("Set up sheets", "setupHotDrinkTally")
    .addItem("Install nightly archive", "installNightlyArchiveTrigger")
    .addItem("Archive completed days now", "archiveCompletedDrinkLogDays")
    .addToUi();
}

function getPublicAppConfig() {
  setupHotDrinkTally();
  const settings = getSettings_();
  return {
    appName: HOT_DRINKS_CONFIG.appName,
    floors: settings.floors,
    drinks: settings.drinks,
    timeBuckets: HOT_DRINKS_CONFIG.timeBuckets,
    defaultFloor: settings.floors[0] || "3rd Floor",
    serverDate: Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd")
  };
}

function setupHotDrinkTally() {
  const spreadsheet = getSpreadsheet_();
  const log = getOrCreateSheet_(spreadsheet, HOT_DRINKS_CONFIG.sheets.drinkLog, DRINK_LOG_HEADERS);
  const settings = getOrCreateSheet_(spreadsheet, HOT_DRINKS_CONFIG.sheets.settings, SETTINGS_HEADERS);
  const dashboard = getOrCreateSheet_(spreadsheet, HOT_DRINKS_CONFIG.sheets.dashboardData, DASHBOARD_DATA_HEADERS);
  const audit = getOrCreateSheet_(spreadsheet, HOT_DRINKS_CONFIG.sheets.auditLog, AUDIT_LOG_HEADERS);

  seedSettings_(settings);
  formatSheet_(log, DRINK_LOG_HEADERS.length);
  formatSheet_(settings, SETTINGS_HEADERS.length);
  formatSheet_(dashboard, DASHBOARD_DATA_HEADERS.length);
  formatSheet_(audit, AUDIT_LOG_HEADERS.length);

  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    sheets: [log.getName(), settings.getName(), dashboard.getName(), audit.getName()]
  };
}

function getSpreadsheet_() {
  const propertyId = PropertiesService.getScriptProperties().getProperty("HOT_DRINK_SPREADSHEET_ID");
  if (propertyId) return SpreadsheetApp.openById(propertyId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("No spreadsheet is bound. Create this Apps Script from a Google Sheet or set HOT_DRINK_SPREADSHEET_ID.");
}

function setHotDrinkSpreadsheetId(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = match ? match[1] : text;
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty("HOT_DRINK_SPREADSHEET_ID", id);
  return setupHotDrinkTally();
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  ensureHeaders_(sheet, headers);
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const missing = headers.filter(function(header) { return current.indexOf(header) === -1; });
  if (!current[0]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  missing.forEach(function(header) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
  });
}

function formatSheet_(sheet, headerCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headerCount)
    .setFontWeight("bold")
    .setBackground("#101820")
    .setFontColor("#ffffff");
  sheet.autoResizeColumns(1, headerCount);
}

function seedSettings_(sheet) {
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  const keys = existing.map(function(row) { return row[0] + "|" + row[1]; });
  const missing = getDefaultSettingsRows_().filter(function(row) {
    return keys.indexOf(row[0] + "|" + row[1]) === -1;
  });
  if (missing.length) sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, SETTINGS_HEADERS.length).setValues(missing);
}

function getSettings_() {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.settings, SETTINGS_HEADERS);
  seedSettings_(sheet);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  const active = rows.filter(function(row) {
    return String(row[3]).toLowerCase() !== "false" && row[3] !== false;
  });
  const floors = active.filter(function(row) { return row[0] === "Floor"; }).map(function(row) { return String(row[2] || row[1]); });
  const drinks = active.filter(function(row) { return row[0] === "Drink"; }).map(function(row) { return String(row[2] || row[1]); });
  const bankHolidays = active.filter(function(row) { return row[0] === "Bank Holiday" && row[2]; }).map(function(row) { return dateKey_(row[2]); });
  const closedPeriods = active.filter(function(row) { return row[0] === "Closed Period" && row[2]; }).map(function(row) { return String(row[2]); });
  const closedDays = active.filter(function(row) { return row[0] === "Closed Day" && row[2]; }).map(function(row) { return dateKey_(row[2]); });
  return {
    floors: orderedSettingsValues_(floors, HOT_DRINKS_CONFIG.floors),
    drinks: orderedSettingsValues_(drinks, HOT_DRINKS_CONFIG.drinks),
    bankHolidays: bankHolidays.filter(Boolean),
    closedPeriods: closedPeriods,
    closedDays: closedDays.filter(Boolean)
  };
}

function orderedSettingsValues_(values, preferredOrder) {
  const seen = {};
  const cleaned = (values || []).map(function(value) { return String(value || "").trim(); }).filter(Boolean);
  const ordered = (preferredOrder || []).filter(function(value) {
    if (cleaned.indexOf(value) === -1 || seen[value]) return false;
    seen[value] = true;
    return true;
  });
  cleaned.forEach(function(value) {
    if (!seen[value]) {
      ordered.push(value);
      seen[value] = true;
    }
  });
  return ordered.length ? ordered : (preferredOrder || []).slice();
}

function getSettingsForAdmin() {
  setupHotDrinkTally();
  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.settings);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  return { ok: true, headers: SETTINGS_HEADERS, rows: rows };
}

function saveSettingsRows(rows) {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.settings, SETTINGS_HEADERS);
  const cleanRows = (rows || []).filter(function(row) { return row && row[0] && row[1]; }).map(function(row) {
    return [row[0], row[1], row[2] || "", row[3] === true || String(row[3]).toLowerCase() === "true", row[4] || ""];
  });
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).clearContent();
  if (cleanRows.length) sheet.getRange(2, 1, cleanRows.length, SETTINGS_HEADERS.length).setValues(cleanRows);
  logAudit_("SETTINGS_SAVED", "", "", "", getUser_(), cleanRows.length + " setting rows saved.");
  return getPublicAppConfig();
}
