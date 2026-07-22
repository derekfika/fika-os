function doGet() {
  const template = HtmlService.createTemplateFromFile("Index");
  template.initialConfig = JSON.stringify(getPublicAppConfig());
  return template.evaluate()
    .setTitle("Munich RE Hot Drink Reporting")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Hot Drink Reporting")
    .addItem("Set up sheets", "setupHotDrinkTally")
    .addItem("Rebuild dashboard cache", "refreshDashboardData")
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
  const targetId = HOT_DRINKS_CONFIG.tillSpreadsheetId;
  if (propertyId !== targetId) {
    PropertiesService.getScriptProperties().setProperty("HOT_DRINK_SPREADSHEET_ID", targetId);
  }
  return SpreadsheetApp.openById(targetId);
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

function pointReportingAtTillSpreadsheet() {
  return setHotDrinkSpreadsheetId(HOT_DRINKS_CONFIG.tillSpreadsheetId);
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
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getDisplayValues()
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

function importUkBankHolidaysForYear(year) {
  setupHotDrinkTally();
  const targetYear = Number(year || Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy"));
  if (!targetYear || targetYear < 2020 || targetYear > 2100) throw new Error("Choose a valid year.");

  const response = UrlFetchApp.fetch("https://www.gov.uk/bank-holidays.json", { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error("Could not fetch GOV.UK bank holidays. Response code: " + response.getResponseCode());
  }
  const data = JSON.parse(response.getContentText());
  const events = (((data || {})["england-and-wales"] || {}).events || []).filter(function(event) {
    return String(event.date || "").indexOf(String(targetYear) + "-") === 0;
  });
  if (!events.length) throw new Error("No England and Wales bank holidays found for " + targetYear + ".");

  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.settings, SETTINGS_HEADERS);
  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  const existingKeys = {};
  existingRows.forEach(function(row) {
    if (row[0] === "Bank Holiday") existingKeys[String(row[2] || "")] = true;
  });

  const newRows = events.filter(function(event) {
    return !existingKeys[String(event.date || "")];
  }).map(function(event) {
    return ["Bank Holiday", event.title, event.date, true, "Imported from GOV.UK England and Wales bank holidays."];
  });

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, SETTINGS_HEADERS.length).setValues(newRows);
  }
  logAudit_("BANK_HOLIDAYS_IMPORTED", "", "", "", getUser_(), newRows.length + " bank holidays imported for " + targetYear + ".");
  return { ok: true, year: targetYear, imported: newRows.length, totalForYear: events.length };
}

function addCustomClosedDay(date, name) {
  setupHotDrinkTally();
  const dateKey = dateKey_(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Choose a valid closed date.");
  const label = String(name || "").trim() || "Site closed";
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.settings, SETTINGS_HEADERS);
  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues()
    : [];
  const alreadyExists = existingRows.some(function(row) {
    return row[0] === "Closed Day" && dateKey_(row[2]) === dateKey;
  });
  if (!alreadyExists) {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, SETTINGS_HEADERS.length)
      .setValues([["Closed Day", label, dateKey, true, "Custom site closure day."]]);
  }
  logAudit_("CLOSED_DAY_ADDED", "", "", "", getUser_(), (alreadyExists ? "Existing" : "New") + " closed day: " + dateKey + ".");
  return { ok: true, date: dateKey, name: label, added: !alreadyExists };
}

function getReportingDataHealth() {
  setupHotDrinkTally();
  const spreadsheet = getSpreadsheet_();
  const settings = getSettings_();
  const sheetRows = getSheetLogRows_();
  const archiveRows = readArchivedLogRows_();
  const today = Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
  const activeSheetRows = sheetRows.filter(function(row) { return row.status === "ACTIVE"; });
  const activeTodayRows = activeSheetRows.filter(function(row) { return row.date === today; });
  const drinksToday = {};
  activeTodayRows.forEach(function(row) {
    drinksToday[row.drink] = (drinksToday[row.drink] || 0) + 1;
  });
  const result = {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    timezone: HOT_DRINKS_CONFIG.timezone,
    today: today,
    settingsDrinks: settings.drinks,
    liveRows: sheetRows.length,
    liveActiveRows: activeSheetRows.length,
    liveActiveRowsToday: activeTodayRows.length,
    archivedRows: archiveRows.length,
    drinksToday: drinksToday,
    latestLiveRows: sheetRows.slice(-10).reverse().map(function(row) {
      return {
        date: row.date,
        time: row.time,
        floor: row.floor,
        drink: row.drink,
        status: row.status,
        archived: row.archived
      };
    })
  };
  Logger.log(JSON.stringify(result, null, 2));
  writeReportingDataHealthSheet_(spreadsheet, result);
  return "Reporting data health written to the Reporting_Data_Health tab. Live today: " + result.liveActiveRowsToday + ". Spreadsheet: " + result.spreadsheetName + " (" + result.spreadsheetId + ")";
}

function writeReportingDataHealthSheet_(spreadsheet, result) {
  const name = "Reporting_Data_Health";
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  sheet.clear();
  const latestRows = result.latestLiveRows || [];
  const drinkRows = Object.keys(result.drinksToday || {}).sort().map(function(drink) {
    return [drink, result.drinksToday[drink]];
  });
  const summaryRows = [
    ["Generated At", new Date()],
    ["Spreadsheet Name", result.spreadsheetName],
    ["Spreadsheet ID", result.spreadsheetId],
    ["Timezone", result.timezone],
    ["Today", result.today],
    ["Live Rows", result.liveRows],
    ["Live Active Rows", result.liveActiveRows],
    ["Live Active Rows Today", result.liveActiveRowsToday],
    ["Archived Rows", result.archivedRows],
    ["Settings Drinks", result.settingsDrinks.join(", ")]
  ];
  sheet.getRange(1, 1, summaryRows.length, 2).setValues(summaryRows);
  sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#00538A").setFontColor("#ffffff");

  const drinkStart = summaryRows.length + 3;
  sheet.getRange(drinkStart, 1, 1, 2).setValues([["Drink Today", "Count"]]).setFontWeight("bold").setBackground("#101820").setFontColor("#ffffff");
  if (drinkRows.length) sheet.getRange(drinkStart + 1, 1, drinkRows.length, 2).setValues(drinkRows);

  const latestStart = drinkStart + Math.max(drinkRows.length, 1) + 3;
  const latestHeader = ["Date", "Time", "Floor", "Drink", "Status", "Archived"];
  sheet.getRange(latestStart, 1, 1, latestHeader.length).setValues([latestHeader]).setFontWeight("bold").setBackground("#101820").setFontColor("#ffffff");
  if (latestRows.length) {
    sheet.getRange(latestStart + 1, 1, latestRows.length, latestHeader.length).setValues(latestRows.map(function(row) {
      return [row.date, row.time, row.floor, row.drink, row.status, row.archived];
    }));
  }
  sheet.autoResizeColumns(1, latestHeader.length);
}
