const WORKFORCE_SETTINGS_ROWS = [
  ["BRIGHTHR_SYNC_ENABLED", "FALSE", "BrightHR", "Enable BrightHR sync", "TRUE once token/API URLs are confirmed."],
  ["ROTA_WEEK_START_DAY", "Monday", "Rota", "Week start day", "Used by the weekly rota builder."],
  ["DEFAULT_SHIFT_START", "07:00", "Rota", "Default shift start", "Fallback only."],
  ["DEFAULT_SHIFT_END", "15:00", "Rota", "Default shift end", "Fallback only."],
  ["AGENCY_ALERT_EMAIL", "", "Agency", "Agency alert email", "Optional escalation inbox."],
  ["RELIEF_ASSIGNMENT_FROM_NAME", "FIKA Workforce", "Relief", "Email sender name", "Shown on relief assignment emails."],
  ["BRIGHTHR_API_BASE_URL", "https://api.bright.hr", "BrightHR", "API base URL", "Stored in Script Properties for live sync."],
  ["BRIGHTHR_EMPLOYEE_ENDPOINT", "employees/v1/query", "BrightHR", "Employee endpoint", "Stored in Script Properties if changed."],
  ["BRIGHTHR_ABSENCE_ENDPOINT", "", "BrightHR", "Absence endpoint", "Example: absences/v1/query."],
  ["BRIGHTHR_ABSENCE_METHOD", "post", "BrightHR", "Absence method", "GET or POST."],
  ["BRIGHTHR_ABSENCE_LOOKAHEAD_DAYS", "28", "BrightHR", "Absence lookahead", "Future days to request. BrightHR allows a maximum 31 day From/To range."],
  ["BRIGHTHR_ABSENCE_LOOKBACK_DAYS", "3", "BrightHR", "Absence lookback", "Past days to request. Keep lookback + lookahead at 31 days or less."],
  ["BRIGHTHR_ABSENCE_BATCH_SIZE", "25", "BrightHR", "Absence batch size", "How many employees to query per web-app batch to avoid BrightHR rate limits."]
];

function setupWorkforceOperationsPlatform() {
  const spreadsheet = getWorkforceSpreadsheet_();
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.staffDirectory, [
    "Employee ID", "Name", "Email", "External Reference", "Role",
    "Primary Site", "Secondary Sites", "Contract Hours", "Employment Status",
    "Registered", "Terminated", "Relief Team", "Event Team", "Coffee Trainer",
    "Manager", "BrightHR Raw JSON", "Last Synced"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.absences, [
    "Absence ID", "Employee ID", "Employee Name", "Absence Type",
    "Start Date", "End Date", "Status", "Source", "BrightHR Raw JSON", "Last Synced"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.sites, [
    "Site ID", "Site Name", "Address", "Manager", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.managers, [
    "Manager ID", "Manager Name", "Email", "Phone", "Primary Site ID",
    "Secondary Site IDs", "Receives Gap Alerts", "Receives Agency Confirmations",
    "Active", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.agencyContacts, [
    "Agency ID", "Agency Name", "Contact Name", "Email", "Phone",
    "Roles Supplied", "Sites Covered", "Default Rate", "Active", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.emailTemplates, [
    "Template ID", "Template Name", "Purpose", "Subject", "Body", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.roleLibrary, [
    "Role ID", "Role Name", "Role Group", "Can Be Covered By Relief",
    "Can Be Covered By Agency", "Priority", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.shiftPatterns, [
    "Pattern ID", "Pattern Name", "Start Time", "End Time",
    "Break Minutes", "Paid Hours", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.notificationRules, [
    "Rule ID", "Trigger", "Recipient Type", "Recipient Email",
    "Enabled", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.costRates, [
    "Rate ID", "Type", "Role", "Site ID", "Hourly Rate", "Currency",
    "Effective From", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.siteRoles, [
    "Site ID", "Role", "Required Monday", "Required Tuesday",
    "Required Wednesday", "Required Thursday", "Required Friday",
    "Required Saturday", "Required Sunday", "Priority"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.personStandardRota, [
    "Employee ID", "Employee Name", "Day of Week", "Site", "Role",
    "Start Time", "End Time", "Effective From", "Effective To", "Active", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.rotaTemplates, [
    "Template ID", "Site ID", "Site Name", "Weekday", "Role",
    "Employee Name", "Standard Status", "Source", "Observations", "Active"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.rotaExceptions, [
    "Exception ID", "Site ID", "Site Name", "Date", "Weekday", "Role",
    "Employee Name", "Standard Status", "Actual Status", "Exception Type",
    "Source", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.rotaShifts, [
    "Shift ID", "Site ID", "Site Name", "Date", "Role", "Employee ID",
    "Employee Name", "Start Time", "End Time", "Status", "Source", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.reliefSuggestions, [
    "Suggestion ID", "Gap ID", "Site ID", "Date", "Role", "Suggested Employee ID",
    "Suggested Employee Name", "Reason", "Score", "Reviewed", "Approved"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.reliefAssignments, [
    "Assignment ID", "Gap ID", "Site ID", "Site Name", "Date", "Weekday",
    "Role", "Covering Employee ID", "Covering Employee Name", "Covering Email",
    "Covered Employee Name", "Status", "Score", "Reason", "Generated At", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.coverHistory, [
    "Cover History ID", "Gap ID", "Site ID", "Site Name", "Date", "Weekday",
    "Role", "Covered Employee Name", "Covering Employee ID", "Covering Employee Name",
    "Cover Type", "Source", "Outcome", "Notes", "Recorded At", "Recorded By"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.agencyRequests, [
    "Agency Request ID", "Site ID", "Date", "Role", "Agency", "Rate",
    "Hours", "Status", "Requested By", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.coverageGaps, [
    "Gap ID", "Site ID", "Site Name", "Date", "Weekday", "Role",
    "Employee Name", "Gap Type", "Priority", "Status", "Source", "Notes"
  ]);
  setupWorkforceSheet_(spreadsheet, WORKFORCE_CONFIG.sheets.reliefAvailability, [
    "Availability ID", "Relief Name", "Date", "Weekday", "Site Code",
    "Site Name", "Shift", "Start Time", "End Time", "Status", "Source", "Notes"
  ]);
  seedWorkforceDefaultRows_(spreadsheet);
  setupWorkforceSettingsSheet_(spreadsheet);
  return {
    ok: true,
    appName: WORKFORCE_CONFIG.appName,
    spreadsheetName: spreadsheet.getName()
  };
}

function seedWorkforceDefaultRows_(spreadsheet) {
  seedWorkforceRows_(spreadsheet, WORKFORCE_CONFIG.sheets.emailTemplates, "Template ID", [
    {
      "Template ID": "agency_request",
      "Template Name": "Agency request",
      "Purpose": "Ask an agency to cover a shift",
      "Subject": "Agency cover request | {{siteName}} | {{date}} | {{role}}",
      "Body": "Hi {{contactName}},\n\nCould you please confirm cover for {{siteName}} on {{date}} for {{role}}?\n\nThanks,\nFIKA Workforce",
      "Active": true
    },
    {
      "Template ID": "manager_gap_alert",
      "Template Name": "Manager gap alert",
      "Purpose": "Notify site manager of a staffing gap",
      "Subject": "Staffing gap | {{siteName}} | {{date}}",
      "Body": "Hi {{managerName}},\n\nA staffing gap has been detected at {{siteName}} on {{date}} for {{role}}.\n\nWe are reviewing relief/agency options.\n\nThanks,\nFIKA Workforce",
      "Active": true
    }
  ]);
  seedWorkforceRows_(spreadsheet, WORKFORCE_CONFIG.sheets.roleLibrary, "Role ID", [
    { "Role ID": "manager", "Role Name": "Manager", "Role Group": "Management", "Can Be Covered By Relief": true, "Can Be Covered By Agency": false, "Priority": 1, "Active": true },
    { "Role ID": "barista", "Role Name": "Barista", "Role Group": "Coffee", "Can Be Covered By Relief": true, "Can Be Covered By Agency": true, "Priority": 2, "Active": true },
    { "Role ID": "chef", "Role Name": "Chef", "Role Group": "Kitchen", "Can Be Covered By Relief": true, "Can Be Covered By Agency": true, "Priority": 1, "Active": true },
    { "Role ID": "hospitality", "Role Name": "Hospitality", "Role Group": "Hospitality", "Can Be Covered By Relief": true, "Can Be Covered By Agency": true, "Priority": 2, "Active": true },
    { "Role ID": "kp", "Role Name": "KP", "Role Group": "Kitchen", "Can Be Covered By Relief": true, "Can Be Covered By Agency": true, "Priority": 3, "Active": true }
  ]);
  seedWorkforceRows_(spreadsheet, WORKFORCE_CONFIG.sheets.shiftPatterns, "Pattern ID", [
    { "Pattern ID": "standard_day", "Pattern Name": "Standard day", "Start Time": "07:00", "End Time": "15:00", "Break Minutes": 30, "Paid Hours": 7.5, "Active": true },
    { "Pattern ID": "hospitality_day", "Pattern Name": "Hospitality day", "Start Time": "08:00", "End Time": "16:00", "Break Minutes": 30, "Paid Hours": 7.5, "Active": true }
  ]);
}

function seedWorkforceRows_(spreadsheet, sheetName, keyHeader, rowObjects) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || !rowObjects.length) return;
  const map = workforceHeaderMap_(sheet);
  const keyColumn = map[keyHeader];
  if (!keyColumn) return;
  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, keyColumn, sheet.getLastRow() - 1, 1)
      .getDisplayValues()
      .forEach(function(row) {
        if (row[0]) existing[String(row[0]).trim()] = true;
      });
  }
  const headers = Object.keys(map);
  const rows = rowObjects
    .filter(function(rowObject) {
      return !existing[String(rowObject[keyHeader] || "").trim()];
    })
    .map(function(rowObject) {
      return headers.map(function(header) {
        return Object.prototype.hasOwnProperty.call(rowObject, header)
          ? rowObject[header]
          : "";
      });
    });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
      .setValues(rows);
  }
}

function setWorkforceSpreadsheetId(value) {
  const id = extractWorkforceSpreadsheetId_(value);
  if (!id) throw new Error("Paste a valid Google Sheets URL or spreadsheet ID.");
  const spreadsheet = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties()
    .setProperty(WORKFORCE_CONFIG.scriptProperties.workforceSpreadsheetId, id);
  return {
    ok: true,
    spreadsheetId: id,
    spreadsheetName: spreadsheet.getName()
  };
}

function getWorkforceSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty(WORKFORCE_CONFIG.scriptProperties.workforceSpreadsheetId);
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error(
    "No workforce spreadsheet is configured. Run setWorkforceSpreadsheetId(\"SHEET_URL_OR_ID\")."
  );
}

function extractWorkforceSpreadsheetId_(value) {
  const text = String(value || "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(text) ? text : "";
}

function setupWorkforceSheet_(spreadsheet, name, headers) {
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
    .setBackground("#221874")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  return sheet;
}

function setupWorkforceSettingsSheet_(spreadsheet) {
  const name = WORKFORCE_CONFIG.sheets.settings;
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 5)
      .setValues([["Key", "Value", "Section", "Label", "Notes"]]);
  }
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
      .map(function(row) { return row[0]; })
    : [];
  const missing = WORKFORCE_SETTINGS_ROWS.filter(function(row) {
    return existing.indexOf(row[0]) === -1;
  });
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 5).setValues(missing);
  }
  sheet.getRange(1, 1, 1, 5)
    .setFontWeight("bold")
    .setBackground("#221874")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(5, 420);
}
