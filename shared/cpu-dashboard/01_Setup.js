function setupCpuDashboard() {
  ensureCpuSettingsSheet_();
  ensureCpuOrdersSheet_();
  ensureCpuDeliveriesSheet_();
  ensureCpuScanLogSheet_();
  return {
    ok: true,
    message: "CPU dashboard sheets are ready.",
    spreadsheetUrl: SpreadsheetApp.getActive().getUrl()
  };
}

function ensureCpuDeliveriesSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CPU_CONFIG.DELIVERY_SHEET);
  if (!sheet) sheet = ss.insertSheet(CPU_CONFIG.DELIVERY_SHEET);
  const headers = CPU_CONFIG.DELIVERY_HEADERS;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    headers.forEach(function(header, index) {
      if (sheet.getRange(1, index + 1).getValue() !== header) {
        sheet.getRange(1, index + 1).setValue(header);
      }
    });
  }
  return sheet;
}

function installCpuSiteDirectory() {
  const sheet = ensureCpuSettingsSheet_();
  const lastRow = sheet.getLastRow();
  const keys = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
    : [];
  let rowNumber = 0;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === "SITES_JSON") {
      rowNumber = i + 2;
      break;
    }
  }
  if (!rowNumber) {
    rowNumber = sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1).setValue("SITES_JSON");
  }
  sheet.getRange(rowNumber, 2).setValue(JSON.stringify(CPU_SITE_DIRECTORY));
  sheet.getRange(rowNumber, 3).setValue("Installed from the CPU project's authoritative site directory.");
  clearCpuRuntimeConfigCache_();
  return { ok: true, sites: CPU_SITE_DIRECTORY.length };
}

function installCpuProductCategories() {
  const sheet = ensureCpuSettingsSheet_();
  const map = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
      .forEach(function(row, index) { map[String(row[0] || "").trim()] = index + 2; });
  }
  const rowNumber = map.PRODUCT_CATEGORIES_JSON || sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, 3).setValues([[
    "PRODUCT_CATEGORIES_JSON",
    JSON.stringify(CPU_PRODUCT_CATEGORIES),
    "Edit category names, order and keywords here. The first matching category is used."
  ]]);
  clearCpuRuntimeConfigCache_();
  bumpCpuDataVersion_();
  return { ok: true, categories: CPU_PRODUCT_CATEGORIES.length };
}

function ensureCpuSettingsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CPU_CONFIG.SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CPU_CONFIG.SETTINGS_SHEET);
    sheet.getRange(1, 1, 1, 3).setValues([["Setting", "Value", "Notes"]]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 3);
  }

  const existingKeys = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
      .map(function(row) { return String(row[0]).trim(); })
    : [];
  const rows = Object.keys(CPU_CONFIG.DEFAULT_SETTINGS)
    .filter(function(key) { return existingKeys.indexOf(key) === -1; })
    .map(function(key) {
      let notes = "";
      if (key === "CALENDARS_JSON") {
        notes = 'Current setup: [{"id":"cpux@fikacatering.com","name":"CPU Hospitality Calendar"}]';
      } else if (key === "SITES_JSON") {
        notes = 'Optional site registry: [{"name":"One Angel Court","code":"OAC","colour":"#4F34C7","aliases":["Angel Court"]}]';
      } else if (key === "PRODUCT_CATEGORIES_JSON") {
        notes = "Run installCpuProductCategories once, then edit category names, order and keywords in this row.";
      } else if (key === "DEEP_SCAN_MODE") {
        notes = "FALSE keeps scans fast by skipping unchanged bookings. TRUE reopens and reparses every quote in the scan range.";
      } else if (key === "SHOW_UPDATED_FLAGS") {
        notes = "TRUE displays Updated badges. FALSE hides them while retaining change history and filtering.";
      } else if (key === "PREP_PHOTO_FOLDER_NAME") {
        notes = "Drive folder used for proof-of-prep photos captured from tablets.";
      }
      const value = key === "PRODUCT_CATEGORIES_JSON"
        ? JSON.stringify(CPU_PRODUCT_CATEGORIES)
        : CPU_CONFIG.DEFAULT_SETTINGS[key];
      return [key, value, notes];
    });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
    clearCpuRuntimeConfigCache_();
  }
  return sheet;
}

function ensureCpuOrdersSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CPU_CONFIG.DATA_SHEET);
  if (!sheet) sheet = ss.insertSheet(CPU_CONFIG.DATA_SHEET);

  const headers = CPU_CONFIG.ORDER_HEADERS;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getValues()[0];
    headers.forEach(function(header, index) {
      if (existing[index] !== header) sheet.getRange(1, index + 1).setValue(header);
    });
  }
  return sheet;
}

function ensureCpuScanLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CPU_CONFIG.SCAN_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CPU_CONFIG.SCAN_LOG_SHEET);
    sheet.getRange(1, 1, 1, 7).setValues([[
      "ScannedAt", "User", "RangeStart", "RangeEnd", "Calendars", "Orders", "Warnings"
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getCpuHeaderMap_(sheet) {
  const values = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  values.forEach(function(value, index) { map[String(value)] = index + 1; });
  return map;
}
