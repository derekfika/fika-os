const WORKFORCE_CONFIG = Object.freeze({
  appName: "FIKA Workforce Operations Platform",
  appVersion: "v0.9.0",
  timeZone: "Europe/London",
  hrProvider: "brighthr",
  brightHr: {
    tokenUrl: "https://login.brighthr.com/connect/token",
    apiBaseUrl: "https://api.bright.hr"
  },
  scriptProperties: {
    workforceSpreadsheetId: "WORKFORCE_SPREADSHEET_ID",
    rotaSnapshotFolderId: "ROTA_SNAPSHOT_FOLDER_ID",
    legacyRotaSpreadsheetId: "LEGACY_ROTA_SPREADSHEET_ID",
    reliefRotaSpreadsheetId: "RELIEF_ROTA_SPREADSHEET_ID",
    brightHrClientId: "BRIGHTHR_CLIENT_ID",
    brightHrClientSecret: "BRIGHTHR_CLIENT_SECRET",
    brightHrTokenUrl: "BRIGHTHR_TOKEN_URL",
    brightHrApiBaseUrl: "BRIGHTHR_API_BASE_URL",
    brightHrEmployeesPath: "BRIGHTHR_EMPLOYEES_PATH",
    brightHrEmployeesMethod: "BRIGHTHR_EMPLOYEES_METHOD",
    brightHrAbsencesPath: "BRIGHTHR_ABSENCES_PATH",
    brightHrAbsencesMethod: "BRIGHTHR_ABSENCES_METHOD",
    brightHrTokenPropertyKey: "BRIGHTHR_TOKEN_PROPERTY_KEY",
    brightHrAbsenceLookaheadDays: "BRIGHTHR_ABSENCE_LOOKAHEAD_DAYS",
    brightHrAbsenceLookbackDays: "BRIGHTHR_ABSENCE_LOOKBACK_DAYS",
    brightHrAbsenceBatchSize: "BRIGHTHR_ABSENCE_BATCH_SIZE",
    brightHrAbsenceSyncCursor: "BRIGHTHR_ABSENCE_SYNC_CURSOR",
    brightHrAccessToken: "BRIGHTHR_ACCESS_TOKEN",
    brightHrAccessTokenExpiresAt: "BRIGHTHR_ACCESS_TOKEN_EXPIRES_AT"
  },
  sheets: {
    staffDirectory: "Staff Directory",
    absences: "Absences",
    sites: "Sites",
    managers: "Managers",
    agencyContacts: "Agency Contacts",
    emailTemplates: "Email Templates",
    roleLibrary: "Role Library",
    shiftPatterns: "Shift Patterns",
    notificationRules: "Notification Rules",
    costRates: "Cost Rates",
    siteRoles: "Site Roles",
    personStandardRota: "Person Standard Rota",
    rotaTemplates: "Rota Templates",
    rotaExceptions: "Rota Exceptions",
    rotaShifts: "Rota Shifts",
    reliefSuggestions: "Relief Suggestions",
    reliefAssignments: "Relief Assignments",
    coverHistory: "Cover History",
    agencyRequests: "Agency Requests",
    coverageGaps: "Coverage Gaps",
    reliefAvailability: "Relief Availability",
    settings: "Workforce Settings"
  },
  legacyRota: {
    sourceName: "Legacy Rota Import",
    importStartDate: "2026-06-29",
    dayAssignmentColumns: [2, 4, 6, 8, 10, 12, 14],
    firstDataRow: 4
  },
  reliefRota: {
    sourceName: "Relief Rota Import",
    importStartDate: "2026-06-29",
    dayColumns: [2, 3, 4, 5, 6, 7, 8]
  }
});
