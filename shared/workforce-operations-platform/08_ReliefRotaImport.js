function setReliefRotaSpreadsheetId(value) {
  const id = extractWorkforceSpreadsheetId_(value);
  if (!id) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  const spreadsheet = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties()
    .setProperty(WORKFORCE_CONFIG.scriptProperties.reliefRotaSpreadsheetId, id);
  return {
    ok: true,
    spreadsheetId: id,
    spreadsheetName: spreadsheet.getName()
  };
}

function previewReliefRotaImport() {
  const source = getReliefRotaSpreadsheet_();
  const result = collectReliefRotaRows_(source);
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    importStartDate: WORKFORCE_CONFIG.reliefRota.importStartDate,
    availabilityRowsFound: result.availability.length,
    sitesFound: Object.keys(result.sites).length,
    sample: result.availability.slice(0, 12)
  };
}

function importReliefRota() {
  setupWorkforceOperationsPlatform();
  const source = getReliefRotaSpreadsheet_();
  const target = getWorkforceSpreadsheet_();
  const result = collectReliefRotaRows_(source);
  upsertReliefImportedSites_(target, result.sites);
  rebuildSheetWithoutMatchingRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.reliefAvailability),
    "Source",
    WORKFORCE_CONFIG.reliefRota.sourceName
  );
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.reliefAvailability),
    "Availability ID",
    result.availability
  );
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    availabilityImported: result.availability.length,
    sitesImported: Object.keys(result.sites).length
  };
}

function getReliefRotaSpreadsheet_() {
  const id = PropertiesService.getScriptProperties()
    .getProperty(WORKFORCE_CONFIG.scriptProperties.reliefRotaSpreadsheetId);
  if (!id) {
    throw new Error(
      "No relief rota spreadsheet is configured. Upload/convert the relief rota " +
      "workbook to Google Sheets, then run setReliefRotaSpreadsheetId(\"SHEET_URL_OR_ID\")."
    );
  }
  return SpreadsheetApp.openById(id);
}

function collectReliefRotaRows_(source) {
  const result = { availability: [], sites: collectReliefLocationDirectory_(source) };
  const cutoff = WORKFORCE_CONFIG.reliefRota.importStartDate;
  source.getSheets().forEach(function(sheet) {
    if (sheet.getName() !== "2026") return;
    const reliefName = getReliefNameFromSheet_(sheet);
    const values = sheet.getDataRange().getValues();
    const displays = sheet.getDataRange().getDisplayValues();
    for (let rowIndex = 0; rowIndex < displays.length; rowIndex++) {
      if (String(displays[rowIndex][0] || "").trim().toLowerCase() !== "date") continue;
      const siteRow = rowIndex + 1;
      const shiftRow = rowIndex + 2;
      WORKFORCE_CONFIG.reliefRota.dayColumns.forEach(function(column) {
        const index = column - 1;
        const date = normaliseWorkforceDate_(values[rowIndex][index] || displays[rowIndex][index]);
        if (!date || date < cutoff) return;
        const siteCode = String(displays[siteRow] && displays[siteRow][index] || "").trim();
        const shift = String(displays[shiftRow] && displays[shiftRow][index] || "").trim();
        if (!siteCode && !shift) return;
        const status = classifyReliefShiftStatus_(siteCode, shift);
        const siteName = (result.sites[slugifyWorkforce_(siteCode)] || {}).siteName || siteCode;
        const times = parseReliefShiftTimes_(shift);
        const id = [
          "relief",
          slugifyWorkforce_(reliefName),
          date.replace(/-/g, ""),
          column
        ].join("_");
        result.availability.push({
          "Availability ID": id,
          "Relief Name": reliefName,
          "Date": date,
          "Weekday": getWorkforceWeekday_(new Date(date + "T00:00:00")),
          "Site Code": siteCode,
          "Site Name": siteName,
          "Shift": shift,
          "Start Time": times.start,
          "End Time": times.end,
          "Status": status,
          "Source": WORKFORCE_CONFIG.reliefRota.sourceName,
          "Notes": "Imported from " + sheet.getName()
        });
      });
    }
  });
  return result;
}

function collectReliefLocationDirectory_(source) {
  const directory = {};
  const sheet = source.getSheetByName("Location Addresses");
  if (!sheet) return directory;
  const values = sheet.getDataRange().getDisplayValues();
  for (let row = 0; row < values.length; row++) {
    for (let col = 0; col < values[row].length; col++) {
      if (String(values[row][col] || "").trim().toLowerCase() !== "location name") continue;
      const siteName = String(values[row][col + 1] || "").trim();
      if (!siteName) continue;
      const addressParts = [];
      for (let offset = 1; offset <= 4; offset++) {
        const label = String(values[row + offset] && values[row + offset][col] || "").trim().toLowerCase();
        const part = String(values[row + offset] && values[row + offset][col + 1] || "").trim();
        if (label === "manager") break;
        if (part) addressParts.push(part);
      }
      const managerRow = row + 5;
      const manager = String(values[managerRow] && values[managerRow][col + 1] || "").trim();
      directory[slugifyWorkforce_(siteName)] = {
        siteName: siteName,
        address: addressParts.join(", "),
        manager: manager
      };
    }
  }
  return directory;
}

function getReliefNameFromSheet_(sheet) {
  const first = String(sheet.getRange(1, 1).getDisplayValue() || "").trim();
  const match = first.match(/^(.+?)\s+ROTA$/i);
  return match ? titleCaseWorkforce_(match[1]) : "Relief Team";
}

function classifyReliefShiftStatus_(siteCode, shift) {
  const text = String((siteCode || "") + " " + (shift || "")).toUpperCase();
  if (/A\/L|ANNUAL LEAVE|HOLIDAY/.test(text)) return "Unavailable";
  if (/B\/H|BANK HOLIDAY/.test(text)) return "Bank Holiday";
  if (/TOIL|SICK|SICKNESS/.test(text)) return "Unavailable";
  if (/\?\?\?/.test(text)) return "Unknown";
  if (siteCode || /\d{1,2}:\d{2}/.test(text)) return "Assigned";
  return "Available";
}

function parseReliefShiftTimes_(shift) {
  const match = String(shift || "").match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  return match ? { start: match[1], end: match[2] } : { start: "", end: "" };
}

function upsertReliefImportedSites_(spreadsheet, sites) {
  const rows = Object.keys(sites).map(function(siteId) {
    return {
      "Site ID": siteId,
      "Site Name": sites[siteId].siteName,
      "Address": sites[siteId].address,
      "Manager": sites[siteId].manager,
      "Active": true
    };
  });
  upsertWorkforceRows_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.sites), "Site ID", rows);
}

function titleCaseWorkforce_(value) {
  return String(value || "").toLowerCase().replace(/\b\w/g, function(match) {
    return match.toUpperCase();
  });
}
