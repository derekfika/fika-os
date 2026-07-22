function setLegacyRotaSpreadsheetId(value) {
  const id = extractWorkforceSpreadsheetId_(value);
  if (!id) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  const spreadsheet = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties()
    .setProperty(WORKFORCE_CONFIG.scriptProperties.legacyRotaSpreadsheetId, id);
  return {
    ok: true,
    spreadsheetId: id,
    spreadsheetName: spreadsheet.getName()
  };
}

function previewLegacyRotaImport(maxSheets) {
  const source = getLegacyRotaSpreadsheet_();
  const summary = collectLegacyRotaRows_(
    source,
    Math.max(1, Number(maxSheets || 3)),
    WORKFORCE_CONFIG.legacyRota.importStartDate
  );
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    sampledSheets: summary.scannedSheets,
    shiftsFound: summary.shifts.length,
    agencyRequestsFound: summary.agencyRequests.length,
    sitesFound: Object.keys(summary.sites).length,
    sampleShifts: summary.shifts.slice(0, 10)
  };
}

function importLegacyRotaSheet(maxSheets) {
  setupWorkforceOperationsPlatform();
  const source = getLegacyRotaSpreadsheet_();
  const target = getWorkforceSpreadsheet_();
  const summary = collectLegacyRotaRows_(
    source,
    Number(maxSheets || 0),
    WORKFORCE_CONFIG.legacyRota.importStartDate
  );
  upsertLegacySites_(target, summary.sites);
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.rotaShifts),
    "Shift ID",
    summary.shifts
  );
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.agencyRequests),
    "Agency Request ID",
    summary.agencyRequests
  );
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    targetSpreadsheetName: target.getName(),
    scannedSheets: summary.scannedSheets,
    sitesImported: Object.keys(summary.sites).length,
    shiftsImported: summary.shifts.length,
    agencyRequestsImported: summary.agencyRequests.length
  };
}

function previewLegacyRotaCompressedImport(maxSheets) {
  const source = getLegacyRotaSpreadsheet_();
  const raw = collectLegacyRotaRows_(
    source,
    Math.max(1, Number(maxSheets || 3)),
    WORKFORCE_CONFIG.legacyRota.importStartDate
  );
  const compressed = compressLegacyRotaRows_(raw);
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    sampledSheets: raw.scannedSheets,
    rawShiftsFound: raw.shifts.length,
    templatesFound: compressed.templates.length,
    exceptionsFound: compressed.exceptions.length,
    agencyRequestsFound: raw.agencyRequests.length,
    sitesFound: Object.keys(raw.sites).length,
    estimatedRowsSaved: Math.max(raw.shifts.length - compressed.templates.length - compressed.exceptions.length, 0),
    sampleTemplates: compressed.templates.slice(0, 10),
    sampleExceptions: compressed.exceptions.slice(0, 10)
  };
}

function importLegacyRotaCompressed(maxSheets) {
  setupWorkforceOperationsPlatform();
  const source = getLegacyRotaSpreadsheet_();
  const target = getWorkforceSpreadsheet_();
  const raw = collectLegacyRotaRows_(
    source,
    Number(maxSheets || 0),
    WORKFORCE_CONFIG.legacyRota.importStartDate
  );
  const compressed = compressLegacyRotaRows_(raw);
  upsertLegacySites_(target, raw.sites);
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates),
    "Template ID",
    compressed.templates
  );
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.rotaExceptions),
    "Exception ID",
    compressed.exceptions
  );
  upsertWorkforceRows_(
    target.getSheetByName(WORKFORCE_CONFIG.sheets.agencyRequests),
    "Agency Request ID",
    raw.agencyRequests
  );
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    targetSpreadsheetName: target.getName(),
    scannedSheets: raw.scannedSheets,
    sitesImported: Object.keys(raw.sites).length,
    rawShiftsScanned: raw.shifts.length,
    templatesImported: compressed.templates.length,
    exceptionsImported: compressed.exceptions.length,
    agencyRequestsImported: raw.agencyRequests.length,
    rowsSaved: Math.max(raw.shifts.length - compressed.templates.length - compressed.exceptions.length, 0)
  };
}

function clearLegacyRotaShiftNoise() {
  const spreadsheet = getWorkforceSpreadsheet_();
  const shiftsDeleted = rebuildSheetWithoutMatchingRows_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaShifts),
    "Source",
    WORKFORCE_CONFIG.legacyRota.sourceName
  );
  const agencyDeleted = rebuildSheetWithoutMatchingRows_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyRequests),
    "Notes",
    /^Imported from /i
  );
  return {
    ok: true,
    shiftsDeleted: shiftsDeleted,
    agencyRequestsDeleted: agencyDeleted,
    message: "Legacy noisy shift rows cleared. Compressed templates/exceptions were not touched."
  };
}

function clearLegacyCompressedImport() {
  const spreadsheet = getWorkforceSpreadsheet_();
  const templatesDeleted = rebuildSheetWithoutMatchingRows_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates),
    "Source",
    WORKFORCE_CONFIG.legacyRota.sourceName
  );
  const exceptionsDeleted = rebuildSheetWithoutMatchingRows_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaExceptions),
    "Source",
    WORKFORCE_CONFIG.legacyRota.sourceName
  );
  const agencyDeleted = rebuildSheetWithoutMatchingRows_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.agencyRequests),
    "Notes",
    /^Imported from /i
  );
  return {
    ok: true,
    templatesDeleted: templatesDeleted,
    exceptionsDeleted: exceptionsDeleted,
    agencyRequestsDeleted: agencyDeleted,
    message: "Legacy compressed import rows cleared."
  };
}

function previewLegacyStandardRota(maxSheets) {
  const source = getLegacyRotaSpreadsheet_();
  const raw = collectLegacyRotaRows_(
    source,
    Math.max(1, Number(maxSheets || 6)),
    WORKFORCE_CONFIG.legacyRota.importStartDate
  );
  const compressed = compressLegacyRotaRows_(raw);
  return {
    ok: true,
    sourceSpreadsheetName: source.getName(),
    importStartDate: WORKFORCE_CONFIG.legacyRota.importStartDate,
    sampledSheets: raw.scannedSheets,
    rawShiftsFound: raw.shifts.length,
    ignoredPlaceholderRows: compressed.ignored,
    templatesFound: compressed.templates.length,
    exceptionsFound: compressed.exceptions.length,
    agencyRequestsFound: raw.agencyRequests.length,
    sampleTemplates: compressed.templates.slice(0, 15),
    sampleExceptions: compressed.exceptions.slice(0, 15)
  };
}

function getLegacyRotaSpreadsheet_() {
  const id = PropertiesService.getScriptProperties()
    .getProperty(WORKFORCE_CONFIG.scriptProperties.legacyRotaSpreadsheetId);
  if (!id) {
    throw new Error(
      "No legacy rota spreadsheet is configured. Upload/convert the old rota " +
      "workbook to Google Sheets, then run setLegacyRotaSpreadsheetId(\"SHEET_URL_OR_ID\")."
    );
  }
  return SpreadsheetApp.openById(id);
}

function collectLegacyRotaRows_(source, maxSheets, startDate) {
  const result = {
    scannedSheets: 0,
    sites: {},
    shifts: [],
    agencyRequests: []
  };
  const limit = Number(maxSheets || 0);
  const cutoff = normaliseLegacyImportCutoff_(startDate);
  source.getSheets().some(function(sheet) {
    if (!isLegacyWeeklyRotaSheet_(sheet)) return false;
    result.scannedSheets++;
    parseLegacyWeeklySheet_(sheet, result, cutoff);
    return limit > 0 && result.scannedSheets >= limit;
  });
  return result;
}

function isLegacyWeeklyRotaSheet_(sheet) {
  const name = sheet.getName();
  if (!/week/i.test(name)) return false;
  if (sheet.getLastRow() < WORKFORCE_CONFIG.legacyRota.firstDataRow) return false;
  const label = String(sheet.getRange(2, 1).getDisplayValue() || "").trim().toLowerCase();
  return label === "week commencing";
}

function parseLegacyWeeklySheet_(sheet, result, cutoff) {
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), 14);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const displayValues = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const dayColumns = WORKFORCE_CONFIG.legacyRota.dayAssignmentColumns;
  let currentSite = "";
  let currentSiteRowSlot = 0;

  for (let rowIndex = WORKFORCE_CONFIG.legacyRota.firstDataRow - 1; rowIndex < values.length; rowIndex++) {
    const siteCell = String(displayValues[rowIndex][0] || "").trim();
    if (siteCell) {
      currentSite = siteCell;
      currentSiteRowSlot = 0;
    }
    if (!currentSite) continue;
    currentSiteRowSlot++;

    const siteId = slugifyWorkforce_(currentSite);
    result.sites[siteId] = currentSite;

    dayColumns.forEach(function(assignmentColumn) {
      const assignmentIndex = assignmentColumn - 1;
      const statusIndex = assignmentColumn;
      const assignmentText = String(displayValues[rowIndex][assignmentIndex] || "").trim();
      const status = String(displayValues[rowIndex][statusIndex] || "").trim();
      if (!assignmentText && !status) return;

      const date = normaliseLegacyRotaDate_(
        values[2][assignmentIndex],
        displayValues[2][assignmentIndex]
      );
      if (!date) return;
      if (cutoff && date < cutoff) return;

      const parsed = parseLegacyAssignment_(assignmentText);
      const shiftId = [
        "legacy",
        siteId,
        date.replace(/-/g, ""),
        rowIndex + 1,
        assignmentColumn
      ].join("_");
      const notes = [
        "Imported from " + sheet.getName(),
        parsed.kind !== "staff" ? parsed.kind : "",
        parsed.raw !== parsed.employeeName ? parsed.raw : ""
      ].filter(Boolean).join(" | ");

      result.shifts.push({
        "Shift ID": shiftId,
        "Site ID": siteId,
        "Site Name": currentSite,
        "Site Row Slot": currentSiteRowSlot,
        "Date": date,
        "Weekday": getLegacyWeekday_(date),
        "Role": parsed.role,
        "Employee ID": "",
        "Employee Name": parsed.employeeName,
        "Start Time": "",
        "End Time": "",
        "Status": status || "UNKNOWN",
        "Source": WORKFORCE_CONFIG.legacyRota.sourceName,
        "Notes": notes,
        "_Kind": parsed.kind,
        "_Raw": parsed.raw
      });

      if (parsed.kind === "agency") {
        if (isIgnorableLegacyShift_({
          "Employee Name": parsed.employeeName,
          "Status": status || "",
          "_Kind": parsed.kind
        })) return;
        result.agencyRequests.push({
          "Agency Request ID": "agency_" + shiftId,
          "Site ID": siteId,
          "Date": date,
          "Role": parsed.role || "Agency",
          "Agency": parsed.employeeName,
          "Rate": "",
          "Hours": "",
          "Status": normaliseLegacyAgencyStatus_(status),
          "Requested By": "",
          "Notes": "Imported from " + sheet.getName()
        });
      }
    });
  }
}

function parseLegacyAssignment_(value) {
  const raw = String(value || "").trim();
  if (!raw) return { kind: "blank", employeeName: "", role: "", raw: raw };
  const prefix = raw.match(/^(Event Support|Agency|Relief|Support)\b\s*-?\s*(.*)$/i);
  if (prefix) {
    const kind = prefix[1].toLowerCase().replace(/\s+/g, "_");
    const rest = String(prefix[2] || "").trim();
    const split = splitLegacyNameRole_(rest);
    return {
      kind: kind === "event_support" ? "support" : kind,
      employeeName: split.name || rest,
      role: split.role || prefix[1],
      raw: raw
    };
  }
  const split = splitLegacyNameRole_(raw);
  return {
    kind: "staff",
    employeeName: split.name || raw,
    role: split.role || "",
    raw: raw
  };
}

function splitLegacyNameRole_(value) {
  const text = String(value || "").trim();
  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return { name: text, role: "" };
  return {
    name: parts.shift().trim(),
    role: parts.join(" - ").trim()
  };
}

function normaliseLegacyAgencyStatus_(status) {
  const clean = String(status || "").trim().toUpperCase();
  if (clean === "YES" || clean === "IN") return "Confirmed";
  if (clean === "NO") return "Not Required";
  if (clean === "TBC") return "Requested";
  return clean || "Imported";
}

function normaliseLegacyRotaDate_(value, displayValue) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
  }
  const display = String(displayValue || "").trim();
  if (!display) return "";
  const parsed = new Date(display);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
  }
  return "";
}

function normaliseLegacyImportCutoff_(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function upsertLegacySites_(spreadsheet, sites) {
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.sites);
  const rows = Object.keys(sites).map(function(siteId) {
    return {
      "Site ID": siteId,
      "Site Name": sites[siteId],
      "Address": "",
      "Manager": "",
      "Active": true
    };
  });
  upsertWorkforceRows_(sheet, "Site ID", rows);
}

function compressLegacyRotaRows_(raw) {
  const templateCounts = {};
  const bestByTemplate = {};
  let ignored = 0;
  raw.shifts.forEach(function(shift) {
    if (isIgnorableLegacyShift_(shift)) {
      ignored++;
      return;
    }
    if (!isLegacyTemplateCandidate_(shift)) return;
    const templateId = getLegacyTemplateId_(shift);
    const variantKey = templateId + "|" + shift.Status;
    templateCounts[variantKey] = (templateCounts[variantKey] || 0) + 1;
    const current = bestByTemplate[templateId];
    if (!current || templateCounts[variantKey] > current.count) {
      bestByTemplate[templateId] = {
        templateId: templateId,
        shift: shift,
        status: shift.Status,
        count: templateCounts[variantKey]
      };
    }
  });

  const templates = Object.keys(bestByTemplate).map(function(templateId) {
    const best = bestByTemplate[templateId];
    return {
      "Template ID": templateId,
      "Site ID": best.shift["Site ID"],
      "Site Name": best.shift["Site Name"],
      "Weekday": best.shift.Weekday,
      "Role": best.shift.Role,
      "Employee Name": best.shift["Employee Name"],
      "Standard Status": best.status,
      "Source": WORKFORCE_CONFIG.legacyRota.sourceName,
      "Observations": best.count,
      "Active": true
    };
  });

  const exceptions = [];
  raw.shifts.forEach(function(shift) {
    if (isIgnorableLegacyShift_(shift)) return;
    const templateId = getLegacyTemplateId_(shift);
    const template = bestByTemplate[templateId];
    const standardStatus = template ? template.status : "";
    const exceptionType = getLegacyExceptionType_(shift, standardStatus);
    if (!exceptionType) return;
    exceptions.push({
      "Exception ID": "exception_" + shift["Shift ID"],
      "Site ID": shift["Site ID"],
      "Site Name": shift["Site Name"],
      "Date": shift.Date,
      "Weekday": shift.Weekday,
      "Role": shift.Role,
      "Employee Name": shift["Employee Name"],
      "Standard Status": standardStatus,
      "Actual Status": shift.Status,
      "Exception Type": exceptionType,
      "Source": WORKFORCE_CONFIG.legacyRota.sourceName,
      "Notes": shift.Notes
    });
  });

  return {
    templates: templates,
    exceptions: exceptions,
    ignored: ignored
  };
}

function isLegacyTemplateCandidate_(shift) {
  if (shift._Kind !== "staff") return false;
  if (!shift["Employee Name"]) return false;
  const status = String(shift.Status || "").trim().toUpperCase();
  return status === "IN" || status === "OFF" || status === "NO";
}

function getLegacyTemplateId_(shift) {
  return [
    "template",
    shift["Site ID"],
    slugifyWorkforce_(shift.Weekday),
    "slot",
    shift["Site Row Slot"] || "0"
  ].join("_");
}

function getLegacyExceptionType_(shift, standardStatus) {
  const status = String(shift.Status || "").trim().toUpperCase();
  const kind = String(shift._Kind || "").trim();
  if (kind === "agency") return "Agency";
  if (kind === "relief") return "Relief";
  if (kind === "support") return "Support";
  if (status === "HOL") return "Holiday";
  if (status === "SICK") return "Sickness";
  if (status === "BANK HOLIDAY") return "Bank Holiday";
  if (status === "HANDOVER") return "Handover";
  if (status === "TBC") return "To Confirm";
  if (!standardStatus && !isLegacyTemplateCandidate_(shift)) return "Non-standard";
  if (standardStatus && status !== String(standardStatus || "").trim().toUpperCase()) {
    return "Status Change";
  }
  return "";
}

function isIgnorableLegacyShift_(shift) {
  const kind = String(shift._Kind || "").trim();
  const status = String(shift.Status || "").trim().toUpperCase();
  const employeeName = String(shift["Employee Name"] || "").trim();
  if (!employeeName && (kind === "relief" || kind === "agency" || kind === "support")) return true;
  if ((kind === "relief" || kind === "support") && status === "NO") return true;
  if (kind === "agency" && status === "NO") return true;
  if (kind === "agency" && /^(hospitality|agency|cover|staff)$/i.test(employeeName)) return true;
  if (kind === "relief" && /^relief$/i.test(employeeName)) return true;
  return false;
}

function getLegacyWeekday_(dateText) {
  const date = new Date(dateText + "T00:00:00");
  if (isNaN(date.getTime())) return "";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
}

function rebuildSheetWithoutMatchingRows_(sheet, header, matcher) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const map = workforceHeaderMap_(sheet);
  const column = map[header];
  if (!column) return 0;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();
  const kept = [];
  let deleted = 0;
  displayValues.forEach(function(row, index) {
    const value = String(row[column - 1] || "");
    const match = matcher instanceof RegExp ? matcher.test(value) : value === String(matcher);
    if (match) {
      deleted++;
    } else {
      kept.push(values[index]);
    }
  });
  if (!deleted) return 0;
  dataRange.clearContent();
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, lastColumn).setValues(kept);
  }
  if (!kept.length) {
    sheet.getRange(2, 1, 1, lastColumn).clearContent();
    return deleted;
  }
  return deleted;
}

function slugifyWorkforce_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}
