function detectCoverageGaps(daysAhead) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const templates = uniqueWorkforceRotaTemplates_(readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaTemplates)
  ).filter(function(row) {
    return workforceBoolean_(row.Active) &&
      String(row["Standard Status"] || "").toUpperCase() === "IN";
  }));
  const absences = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.absences)
  );
  const exceptions = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaExceptions)
  );

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.min(Number(daysAhead || 28), 90));
  const absenceIndex = buildAbsenceIndex_(absences);
  const exceptionIndex = buildRotaExceptionIndex_(exceptions);
  const coverIndex = buildRotaCoverIndex_(exceptions);
  const gaps = [];

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start.getTime() + offset * 86400000);
    const dateText = Utilities.formatDate(date, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
    const weekday = getWorkforceWeekday_(date);
    templates.forEach(function(template) {
      if (String(template.Weekday || "") !== weekday) return;
      const employeeName = String(template["Employee Name"] || "").trim();
      if (!employeeName) return;
      const key = getGapPersonDateKey_(employeeName, dateText);
      const templateKey = getGapTemplateDateKey_(template, dateText);
      const exception = exceptionIndex[templateKey];
      const cover = coverIndex[getCoverDateRoleKey_(template["Site ID"], dateText, template.Role)];
      if (exception && isGapClearedByException_(exception)) return;
      if (cover) return;
      if (exception && String(exception["Exception Type"] || "")) {
        gaps.push(buildCoverageGap_(template, dateText, weekday, exception["Exception Type"], "Exception", exception.Notes || ""));
        return;
      }
      if (absenceIndex[key]) {
        gaps.push(buildCoverageGap_(template, dateText, weekday, absenceIndex[key]["Absence Type"] || "Absence", "BrightHR", ""));
      }
    });
  }

  const sheet = ensureCoverageGapsSheet_(spreadsheet);
  replaceWorkforceRowsBySource_(sheet, "Gap Detection", gaps);
  return {
    ok: true,
    daysScanned: days,
    gapsFound: gaps.length,
    sheet: WORKFORCE_CONFIG.sheets.coverageGaps
  };
}

function ensureCoverageGapsSheet_(spreadsheet) {
  return setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.coverageGaps, [
    "Gap ID", "Site ID", "Site Name", "Date", "Weekday", "Role",
    "Employee Name", "Gap Type", "Priority", "Status", "Source", "Notes"
  ]);
}

function getCoverageGapSummary(limit) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const gaps = readWorkforceObjects_(
    spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps)
  ).filter(function(row) {
    return String(row.Status || "").toLowerCase() !== "resolved";
  });
  gaps.sort(function(a, b) {
    return String(a.Date || "").localeCompare(String(b.Date || "")) ||
      Number(a.Priority || 9) - Number(b.Priority || 9);
  });
  return {
    ok: true,
    count: gaps.length,
    gaps: gaps.slice(0, Math.max(1, Number(limit || 12))).map(formatCoverageGapForUi_)
  };
}

function markCoverageGap_(gapId, action, details) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps);
  const map = workforceHeaderMap_(sheet);
  const keyColumn = map["Gap ID"];
  if (!keyColumn) throw new Error("Coverage Gaps sheet is missing Gap ID.");
  const values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const cleanGapId = String(gapId || "").trim();
  let targetRow = 0;
  let target = null;
  values.forEach(function(row, index) {
    if (String(row[keyColumn - 1] || "").trim() === cleanGapId) {
      targetRow = index + 2;
      target = row;
    }
  });
  if (!targetRow) throw new Error("Gap was not found.");
  const actionLabel = normaliseGapActionLabel_(action);
  const now = Utilities.formatDate(new Date(), WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd HH:mm");
  const existingNotes = map.Notes ? String(target[map.Notes - 1] || "") : "";
  const extra = String((details && details.notes) || "").trim();
  const note = [existingNotes, now + " | " + actionLabel + (extra ? " | " + extra : "")]
    .filter(Boolean)
    .join("\n");
  if (map.Status) sheet.getRange(targetRow, map.Status).setValue(actionLabel);
  if (map.Notes) sheet.getRange(targetRow, map.Notes).setValue(note);
  return {
    ok: true,
    gapId: cleanGapId,
    status: actionLabel,
    message: "Gap marked as " + actionLabel + "."
  };
}

function assignCoverForGap_(gapId, details) {
  const spreadsheet = getWorkforceSpreadsheet_();
  const gap = getCoverageGapById_(spreadsheet, gapId);
  const coverName = String(details.coverName || "").trim();
  const coverType = String(details.coverType || "Relief").trim() || "Relief";
  const notes = String(details.notes || "").trim();
  if (!coverName) throw new Error("Choose who is covering this gap.");
  const date = normaliseWorkforceDate_(gap.Date);
  const exceptionId = [
    "cover",
    gap["Gap ID"],
    slugifyWorkforce_(coverName)
  ].join("_");
  upsertWorkforceRows_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.rotaExceptions), "Exception ID", [{
    "Exception ID": exceptionId,
    "Site ID": gap["Site ID"],
    "Site Name": gap["Site Name"],
    "Date": date,
    "Weekday": gap.Weekday,
    "Role": gap.Role,
    "Employee Name": coverName,
    "Standard Status": "",
    "Actual Status": "IN",
    "Exception Type": coverType,
    "Source": "Web App",
    "Notes": [
      "Cover for " + (gap["Employee Name"] || "gap"),
      notes
    ].filter(Boolean).join(" | ")
  }]);
  markCoverageGap_(gapId, "resolved", {
    notes: coverType + " cover assigned: " + coverName + (notes ? " | " + notes : "")
  });
  recordCoverHistory_(spreadsheet, gap, {
    coverName: coverName,
    coverType: coverType,
    notes: notes,
    source: "Web App",
    outcome: "Assigned"
  });
  return {
    ok: true,
    exceptionId: exceptionId,
    message: "Cover assigned to " + coverName + "."
  };
}

function recordCoverHistory_(spreadsheet, gap, details) {
  details = details || {};
  const coverName = String(details.coverName || "").trim();
  if (!coverName || !gap) return null;
  const date = normaliseWorkforceDate_(gap.Date);
  const sheet = ensureCoverHistorySheet_(spreadsheet);
  const row = {
    "Cover History ID": [
      "cover_history",
      gap["Gap ID"] || slugifyWorkforce_(gap["Employee Name"]),
      slugifyWorkforce_(coverName)
    ].join("_"),
    "Gap ID": gap["Gap ID"],
    "Site ID": gap["Site ID"],
    "Site Name": gap["Site Name"],
    "Date": date,
    "Weekday": gap.Weekday,
    "Role": gap.Role,
    "Covered Employee Name": gap["Employee Name"],
    "Covering Employee ID": String(details.coverEmployeeId || ""),
    "Covering Employee Name": coverName,
    "Cover Type": String(details.coverType || "Relief"),
    "Source": String(details.source || "Web App"),
    "Outcome": String(details.outcome || "Assigned"),
    "Notes": String(details.notes || ""),
    "Recorded At": new Date(),
    "Recorded By": Session.getActiveUser().getEmail()
  };
  upsertWorkforceRows_(sheet, "Cover History ID", [row]);
  return row;
}

function ensureCoverHistorySheet_(spreadsheet) {
  return setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.coverHistory, [
    "Cover History ID", "Gap ID", "Site ID", "Site Name", "Date", "Weekday",
    "Role", "Covered Employee Name", "Covering Employee ID", "Covering Employee Name",
    "Cover Type", "Source", "Outcome", "Notes", "Recorded At", "Recorded By"
  ]);
}

function requestAgencyForGap_(gapId, agencyId, details) {
  const result = createAgencyRequestForGap(gapId, agencyId);
  markCoverageGap_(gapId, "agency_requested", {
    notes: String((details && details.notes) || "").trim()
  });
  return {
    ok: true,
    agencyRequestId: result.agencyRequestId,
    message: "Agency request created and gap marked as agency requested."
  };
}

function getCoverageGapById_(spreadsheet, gapId) {
  const cleanGapId = String(gapId || "").trim();
  const gap = readWorkforceObjects_(spreadsheet.getSheetByName(WORKFORCE_CONFIG.sheets.coverageGaps))
    .filter(function(row) {
      return String(row["Gap ID"] || "").trim() === cleanGapId;
    })[0];
  if (!gap) throw new Error("Gap was not found.");
  return gap;
}

function normaliseGapActionLabel_(action) {
  const text = String(action || "").toLowerCase();
  if (text === "self_cover") return "Self cover";
  if (text === "agency_requested") return "Agency requested";
  if (text === "resolved") return "Resolved";
  if (text === "snoozed") return "Snoozed";
  if (text === "ignored") return "Ignored";
  return "In progress";
}

function formatCoverageGapForUi_(gap) {
  const date = normaliseWorkforceDate_(gap.Date);
  const friendlyDate = date ? Utilities.formatDate(new Date(date + "T00:00:00"), WORKFORCE_CONFIG.timeZone, "EEE d MMM") : "";
  const copy = {};
  Object.keys(gap).forEach(function(key) { copy[key] = gap[key]; });
  copy.Date = date || gap.Date || "";
  copy.FriendlyDate = friendlyDate;
  return copy;
}

function buildAbsenceIndex_(absences) {
  const index = {};
  absences.forEach(function(absence) {
    const name = String(absence["Employee Name"] || "").trim();
    const start = normaliseWorkforceDate_(absence["Start Date"]);
    const end = normaliseWorkforceDate_(absence["End Date"]) || start;
    if (!name || !start) return;
    let date = new Date(start + "T00:00:00");
    const endDate = new Date(end + "T00:00:00");
    while (!isNaN(date.getTime()) && date <= endDate) {
      const dateText = Utilities.formatDate(date, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
      index[getGapPersonDateKey_(name, dateText)] = absence;
      date = new Date(date.getTime() + 86400000);
    }
  });
  return index;
}

function buildRotaExceptionIndex_(exceptions) {
  const index = {};
  exceptions.forEach(function(exception) {
    const date = normaliseWorkforceDate_(exception.Date);
    if (!date) return;
    const key = [
      String(exception["Site ID"] || ""),
      date,
      String(exception.Weekday || ""),
      normaliseWorkforcePerson_(exception["Employee Name"])
    ].join("|");
    index[key] = exception;
  });
  return index;
}

function buildCoverageGap_(template, dateText, weekday, gapType, source, notes) {
  const gapId = [
    "gap",
    template["Site ID"],
    dateText.replace(/-/g, ""),
    slugifyWorkforce_(template.Role || "role"),
    slugifyWorkforce_(template["Employee Name"] || "person")
  ].join("_");
  return {
    "Gap ID": gapId,
    "Site ID": template["Site ID"],
    "Site Name": template["Site Name"],
    "Date": dateText,
    "Weekday": weekday,
    "Role": template.Role,
    "Employee Name": template["Employee Name"],
    "Gap Type": gapType,
    "Priority": getGapPriority_(template.Role),
    "Status": "Open",
    "Source": "Gap Detection",
    "Notes": source + (notes ? " | " + notes : "")
  };
}

function isGapClearedByException_(exception) {
  const type = String(exception["Exception Type"] || "").toLowerCase();
  const status = String(exception["Actual Status"] || "").toUpperCase();
  return type === "relief" || type === "support" || status === "IN";
}

function getGapTemplateDateKey_(template, dateText) {
  return [
    String(template["Site ID"] || ""),
    dateText,
    String(template.Weekday || ""),
    normaliseWorkforcePerson_(template["Employee Name"])
  ].join("|");
}

function getGapPersonDateKey_(name, dateText) {
  return normaliseWorkforcePerson_(name) + "|" + dateText;
}

function normaliseWorkforcePerson_(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getGapPriority_(role) {
  const text = String(role || "").toLowerCase();
  if (/manager|chef/.test(text)) return 1;
  if (/barista|hospitality/.test(text)) return 2;
  return 3;
}

function readWorkforceObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0].map(function(header) { return String(header).trim(); });
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues()
    .map(function(row) {
      const object = {};
      headers.forEach(function(header, index) {
        object[header] = row[index];
      });
      return object;
    })
    .filter(function(object) {
      return headers.some(function(header) {
        return object[header] !== "" && object[header] !== null;
      });
    });
}

function replaceWorkforceRowsBySource_(sheet, source, rowObjects) {
  rebuildSheetWithoutMatchingRows_(sheet, "Source", source);
  if (!rowObjects.length) return;
  appendWorkforceRowsFast_(sheet, rowObjects);
}

function appendWorkforceRowsFast_(sheet, rowObjects) {
  if (!sheet || !rowObjects || !rowObjects.length) return;
  const map = workforceHeaderMap_(sheet);
  const headers = Object.keys(map);
  const values = rowObjects.map(function(rowObject) {
    return headers.map(function(header) {
      return Object.prototype.hasOwnProperty.call(rowObject, header)
        ? rowObject[header]
        : "";
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function normaliseWorkforceDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return isNaN(parsed.getTime())
    ? ""
    : Utilities.formatDate(parsed, WORKFORCE_CONFIG.timeZone, "yyyy-MM-dd");
}

function getWorkforceWeekday_(date) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
}

function workforceBoolean_(value) {
  return value === true || String(value).toUpperCase() === "TRUE" || String(value).toUpperCase() === "YES";
}
