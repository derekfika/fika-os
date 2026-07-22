const CONFIG = {
  APP_VERSION: "v0.11.5-58VE",
  APP_RELEASE_NAME: "Booking Rescan",
  APP_DEVELOPER: "Derek Buckley",
  APP_DEVELOPER_EMAIL: "derek@fikacatering.com",
  APP_ENVIRONMENT: "Production",

  QUOTE_TEMPLATE_DOC_ID: "1-2E0p2D7ivEyL7iB7yTe3tsgoppwSq48itHw7fSaBl0",
  QUOTE_ROOT_FOLDER_NAME: "Hospitality",
  SHEET_NAME: "Dashboard Data",

  PRINTER_EMAIL: "mvt5149ww1d8q0@print.epsonconnect.com",

  DRIVE: {
    ROOT_FOLDER_NAME: "Hospitality"
  },

  CALENDAR: {
    TEST_CALENDAR: "derek@fikacatering.com"
  },

  STATUS: {
    NEW: "NEW",
    NEEDS_REVIEW: "NEEDS_REVIEW",
    READY: "READY",
    QUOTE_GENERATED: "QUOTE_GENERATED",
    CPU_CREATED: "CPU_CREATED",
    CONFIRMED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    ERROR: "ERROR",
    ARCHIVED: "ARCHIVED"
  },

  CALENDAR_ID: "seven@fikacatering.com",

  CALENDAR_ATTENDEES: [
    "cpux@fikacatering.com",
    "dwayne@fikacatering.com",
    "logistics@fikacatering.com"
  ],

  CALENDAR_EVENT_COLOR_ID: "9",
  CALENDAR_EVENT_DURATION_MINUTES: 60,

  APP_NAME: "58VE Hospitality Dashboard",
  LOCATION_NAME: "58 Victoria Embankment",
  LOCATION_SHORT_CODE: "58VE",

  FIKA_LOGO_URL: "https://bloom-coffee.org/bloom-quiz/assets/images/fika_logoRGB.png",
  SITE_LOGO_URL: "",
  PARTNER_LOGO_URL: "",
  FAVICON_URL: "",

  FONT_TITLE_URL: "",
  FONT_BODY_URL: "",
  FONT_TITLE_FAMILY: "VIM",
  FONT_BODY_FAMILY: "Gilroy",

  COLOUR_BACKGROUND: "#F8F6F2",
  COLOUR_SURFACE: "#FFFFFF",
  COLOUR_SURFACE_ALT: "#F1EEE8",
  COLOUR_TEXT: "#252525",
  COLOUR_TEXT_MUTED: "#777777",
  COLOUR_BORDER: "#DED8CD",
  COLOUR_PRIMARY: "#4F34C7",
  COLOUR_SECONDARY: "#280F8C",
  COLOUR_SUCCESS: "#6C8A74",
  COLOUR_WARNING: "#B08B52",
  COLOUR_DANGER: "#8B5E5E",
  COLOUR_INFO: "#5B7EA0",

  ADMIN_PIN_HASH: "1bea20e1df19b12013976de2b5e0e3d1fb4ba088b59fe53642c324298b21ffd9",

  // =========================
  // OPERATIONS
  // =========================

  AUTO_ARCHIVE_ENABLED: true,
  ARCHIVE_AFTER_DAYS: 7,

  REQUIRE_QUOTE_BEFORE_CALENDAR: true,
  REQUIRE_CALENDAR_BEFORE_CONFIRMATION: true,

  // =========================
  // PARSER
  // =========================

  USE_FIRST_SERVICE_TIME_ONLY: true,
  ALLOW_EVENING_TIMES: true,

  DEFAULT_LOCATION: "58 Victoria Embankment",
  DEFAULT_FLOOR: "",

  // =========================
  // CALENDAR
  // =========================

  CALENDAR_TITLE_FORMAT: "{SITE}_{COMPANY}_{SERVICE} x {PAX}",
  CALENDAR_ATTACH_QUOTE: true,
  CALENDAR_ATTACH_ORIGINAL_XLSX: true,

  // =========================
  // EMAILS
  // =========================

  CONFIRMATION_EMAIL_ENABLED: true,
  CONFIRMATION_EMAIL_CC: "",
  CONFIRMATION_EMAIL_BCC: "",

  // =========================
  // DASHBOARD
  // =========================

  SHOW_ARCHIVED_BY_DEFAULT: false,
  HIGHLIGHT_STALE_QUOTES: true,
  HIGHLIGHT_STALE_CALENDAR_EVENTS: true,

  // =========================
  // AUTOMATION
  // =========================

  AUTOMATION_MODE: "MANUAL",
  AUTOMATION_REQUIRE_READY: true,
  AUTOMATION_ALLOW_CONFIRMATION_EMAILS: false
};

let SETTINGS_VALUE_CACHE_ = null;

function getSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("Settings");
  const headers = ["Key", "Value", "Section", "Label", "Type", "Notes"];

  if (!sh) {
    sh = ss.insertSheet("Settings");
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sh;
}

function getSettings_() {
  const sh = getSettingsSheet_();
  const values = sh.getDataRange().getValues();
  const settings = {};

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || "").trim();
    let value = values[i][1];

    if (!key) continue;

    if (typeof value === "string") {
      const upper = value.trim().toUpperCase();
      if (upper === "TRUE") value = true;
      else if (upper === "FALSE") value = false;
    }

    settings[key] = value;
  }

  return settings;
}

function getSettingSchema_() {
  return [
    {
      id: "general",
      title: "General",
      access: "user",
      fields: [
        { key: "APP_NAME", label: "App name", type: "text", fallback: CONFIG.APP_NAME, required: true, notes: "Shown in the browser title and dashboard header." },
        { key: "LOCATION_NAME", label: "Location name", type: "text", fallback: CONFIG.LOCATION_NAME, required: true, notes: "Human-friendly site name." }
      ]
    },
    {
      id: "operations",
      title: "Operations",
      access: "user",
      fields: [
        {
          key: "AUTO_ARCHIVE_ENABLED",
          label: "Enable automatic archiving",
          type: "checkbox",
          fallback: CONFIG.AUTO_ARCHIVE_ENABLED
        },
        { key: "ARCHIVE_AFTER_DAYS", label: "Archive after days", type: "number", fallback: 0, min: 0, notes: "Bookings older than this can be archived automatically. Use 0 to archive before today." }
      ]
    },
    {
      id: "parser",
      title: "Parser",
      access: "user",
      fields: [
        {
          key: "USE_FIRST_SERVICE_TIME_ONLY",
          label: "Use first service time only",
          type: "checkbox",
          fallback: CONFIG.USE_FIRST_SERVICE_TIME_ONLY
        },
        {
          key: "ALLOW_EVENING_TIMES",
          label: "Allow evening times",
          type: "checkbox",
          fallback: CONFIG.ALLOW_EVENING_TIMES
        }
      ]
    }, {
      id: "email",
      title: "Email",
      access: "user",
      fields: [
        {
          key: "CONFIRMATION_EMAIL_CC",
          label: "Confirmation email CC",
          type: "text",
          fallback: CONFIG.CONFIRMATION_EMAIL_CC
        },
        {
          key: "CONFIRMATION_EMAIL_BCC",
          label: "Confirmation email BCC",
          type: "text",
          fallback: CONFIG.CONFIRMATION_EMAIL_BCC
        }
      ]
    },
    {
      id: "dashboard",
      title: "Dashboard",
      access: "user",
      fields: [
        {
          key: "SHOW_ARCHIVED_BY_DEFAULT",
          label: "Show archived bookings by default",
          type: "checkbox",
          fallback: CONFIG.SHOW_ARCHIVED_BY_DEFAULT
        }
      ]
    },
    {
      id: "calendar-user",
      title: "Calendar",
      access: "user",
      fields: [
        { key: "CALENDAR_ATTENDEES", label: "Calendar attendees", type: "textarea", fallback: (CONFIG.CALENDAR_ATTENDEES || []).join(", "), notes: "Comma or line separated email addresses invited to CPU events." }
      ]
    },
    {
      id: "branding",
      title: "Branding",
      access: "user",
      fields: [
        { key: "FIKA_LOGO_URL", label: "FIKA logo URL", type: "url", fallback: CONFIG.FIKA_LOGO_URL, notes: "Main logo shown in the dashboard header." },
        { key: "FAVICON_URL", label: "Favicon URL", type: "url", fallback: CONFIG.FAVICON_URL, notes: "Optional browser tab icon." }
      ]
    },
    {
      id: "colours",
      title: "Colours",
      access: "user",
      fields: [
        { key: "COLOUR_BACKGROUND", label: "Background", type: "color", fallback: CONFIG.COLOUR_BACKGROUND, required: true, notes: "Main dashboard background." },
        { key: "COLOUR_SURFACE", label: "Surface", type: "color", fallback: CONFIG.COLOUR_SURFACE, required: true, notes: "Raised panel background." },
        { key: "COLOUR_SURFACE_ALT", label: "Alternate surface", type: "color", fallback: CONFIG.COLOUR_SURFACE_ALT, required: true, notes: "Cards and table surfaces." },
        { key: "COLOUR_TEXT", label: "Text", type: "color", fallback: CONFIG.COLOUR_TEXT, required: true, notes: "Main text colour." },
        { key: "COLOUR_TEXT_MUTED", label: "Muted text", type: "color", fallback: CONFIG.COLOUR_TEXT_MUTED, required: true, notes: "Secondary text colour." },
        { key: "COLOUR_BORDER", label: "Border", type: "color", fallback: CONFIG.COLOUR_BORDER, required: true, notes: "Border colour." },
        { key: "COLOUR_PRIMARY", label: "Primary", type: "color", fallback: CONFIG.COLOUR_PRIMARY, required: true, notes: "Primary buttons and headings." },
        { key: "COLOUR_SECONDARY", label: "Secondary", type: "color", fallback: CONFIG.COLOUR_SECONDARY, required: true, notes: "Secondary brand accent." },
        { key: "COLOUR_SUCCESS", label: "Success", type: "color", fallback: CONFIG.COLOUR_SUCCESS, required: true, notes: "Success feedback." },
        { key: "COLOUR_WARNING", label: "Warning", type: "color", fallback: CONFIG.COLOUR_WARNING, required: true, notes: "Warning feedback." },
        { key: "COLOUR_DANGER", label: "Danger", type: "color", fallback: CONFIG.COLOUR_DANGER, required: true, notes: "Cancel/error feedback." },
        { key: "COLOUR_INFO", label: "Info", type: "color", fallback: CONFIG.COLOUR_INFO, required: true, notes: "Informational accent." }
      ]
    },
    {
      id: "admin-system",
      title: "Admin: System",
      access: "admin",
      fields: [
        { key: "LOCATION_SHORT_CODE", label: "Location short code", type: "text", fallback: CONFIG.LOCATION_SHORT_CODE, required: true, notes: "Used at the start of calendar event titles." },
        { key: "SHEET_NAME", label: "Dashboard sheet name", type: "text", fallback: CONFIG.SHEET_NAME, required: true, notes: "Must match the tab that stores dashboard booking rows." }
      ]
    },
    {
      id: "admin-inbox",
      title: "Admin: Inbox",
      access: "admin",
      fields: [
        { key: "PROCESSED_LABEL_NAME", label: "Processed Gmail label", type: "text", fallback: "58VE_HOSPITALITY_PROCESSED", notes: "Legacy setting. Duplicate checking now uses Message ID + Attachment Name." },
        { key: "EARLIEST_SCAN_DATE", label: "Earliest scan date", type: "date", fallback: "", notes: "Optional. Use YYYY-MM-DD to stop scans going further back." },
        { key: "LAST_INBOX_SCAN_AT", label: "Last scan timestamp", type: "text", fallback: "", readonly: true, notes: "Updated automatically after a completed inbox scan." }
      ]
    },
    {
      id: "admin-quotes",
      title: "Admin: Quotes",
      access: "admin",
      fields: [
        { key: "QUOTE_TEMPLATE_DOC_ID", label: "Quote template document ID", type: "text", fallback: CONFIG.QUOTE_TEMPLATE_DOC_ID, required: true, notes: "Google Doc template ID used when generating quote files." },
        { key: "QUOTE_ROOT_FOLDER_NAME", label: "Quote root folder", type: "text", fallback: CONFIG.QUOTE_ROOT_FOLDER_NAME, required: true, notes: "Drive folder name where quote folders are created." },
        { key: "PRINTER_EMAIL", label: "Printer email", type: "email", fallback: CONFIG.PRINTER_EMAIL, notes: "Email address used by the print quote action." }
      ]
    },
    {
      id: "admin-calendar",
      title: "Admin: Calendar",
      access: "admin",
      fields: [
        { key: "CALENDAR_ID", label: "Calendar ID", type: "text", fallback: CONFIG.CALENDAR_ID, required: true, notes: "Calendar email or ID where CPU events are created." },
        { key: "CALENDAR_EVENT_COLOR_ID", label: "Event colour ID", type: "text", fallback: CONFIG.CALENDAR_EVENT_COLOR_ID, notes: "Google Calendar colour ID. Usually a number from 1 to 11." },
        { key: "CALENDAR_EVENT_DURATION_MINUTES", label: "Event duration minutes", type: "number", fallback: CONFIG.CALENDAR_EVENT_DURATION_MINUTES, required: true, min: 1, notes: "Length of created calendar events." }
      ]
    },
    {
      id: "admin-branding",
      title: "Admin: Advanced Branding",
      access: "admin",
      fields: [
        { key: "SITE_LOGO_URL", label: "Site logo URL", type: "url", fallback: CONFIG.SITE_LOGO_URL, notes: "Optional logo for the hospitality location." },
        { key: "PARTNER_LOGO_URL", label: "Partner logo URL", type: "url", fallback: CONFIG.PARTNER_LOGO_URL, notes: "Optional secondary client, landlord or partner logo." },
        { key: "FONT_TITLE_URL", label: "Title font URL", type: "url", fallback: CONFIG.FONT_TITLE_URL, notes: "Optional font file URL for headings." },
        { key: "FONT_BODY_URL", label: "Body font URL", type: "url", fallback: CONFIG.FONT_BODY_URL, notes: "Optional font file URL for body text." },
        { key: "FONT_TITLE_FAMILY", label: "Title font family", type: "text", fallback: CONFIG.FONT_TITLE_FAMILY, required: true, notes: "CSS font-family name for headings." },
        { key: "FONT_BODY_FAMILY", label: "Body font family", type: "text", fallback: CONFIG.FONT_BODY_FAMILY, required: true, notes: "CSS font-family name for controls and table text." }
      ]
    },
    {
      id: "admin-automation",
      title: "Admin: Automation",
      access: "admin",
      fields: [
        {
          key: "AUTOMATION_MODE",
          label: "Automation mode",
          type: "select",
          fallback: CONFIG.AUTOMATION_MODE,
          options: [
            { value: "MANUAL", label: "Manual - import only" },
            { value: "QUOTE_ONLY", label: "Quote only" },
            { value: "QUOTE_AND_CALENDAR", label: "Quote + calendar" },
            { value: "FULL", label: "Full automation" }
          ],
          notes: "Controls what happens automatically after a booking is imported."
        },
        {
          key: "AUTOMATION_REQUIRE_READY",
          label: "Only automate READY bookings",
          type: "checkbox",
          fallback: CONFIG.AUTOMATION_REQUIRE_READY,
          notes: "Recommended. Prevents automation running on bookings with validation errors."
        },
        {
          key: "AUTOMATION_ALLOW_CONFIRMATION_EMAILS",
          label: "Allow automatic confirmation emails",
          type: "checkbox",
          fallback: CONFIG.AUTOMATION_ALLOW_CONFIRMATION_EMAILS,
          notes: "Safety switch. Must be enabled before FULL automation can send client emails."
        }
      ]
    }
  ];
}

function getDashboardAbout_() {
  return {
    appName: CONFIG.APP_NAME,
    version: CONFIG.APP_VERSION,
    releaseName: CONFIG.APP_RELEASE_NAME,
    developer: CONFIG.APP_DEVELOPER,
    developerEmail: CONFIG.APP_DEVELOPER_EMAIL,
    environment: CONFIG.APP_ENVIRONMENT,
    platform: "Google Apps Script",
    company: "FIKA Catering"
  };
}

function getDashboardSettings() {
  ensureSettingsDefaults_();

  const stored = getSettings_();
  const schema = getSettingSchema_();
  const values = {};

  schema.forEach(section => {
    section.fields.forEach(field => {
      values[field.key] =
        stored[field.key] !== undefined && stored[field.key] !== ""
          ? stored[field.key]
          : field.fallback;
    });
  });

  return {
    ok: true,
    schema,
    sections: schema,
    values,
    about: getDashboardAbout_(),
    validation: validateDashboardSettings_(values, schema)
  };
}

function ensureSettingsDefaults_() {
  const sh = getSettingsSheet_();
  const schema = getSettingSchema_();
  const values = sh.getDataRange().getValues();
  const existing = {};

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || "").trim();
    if (key) existing[key] = i + 1;
  }

  const rowsToAppend = [];

  schema.forEach(section => {
    section.fields.forEach(field => {
      const metadata = [
        section.title,
        field.label,
        field.type || "text",
        field.notes || (field.readonly ? "Read only" : "")
      ];

      if (existing[field.key]) {
        sh.getRange(existing[field.key], 3, 1, metadata.length).setValues([metadata]);
        return;
      }

      rowsToAppend.push([
        field.key,
        normaliseSettingValue_(field.fallback, field),
        ...metadata
      ]);
    });
  });

  if (rowsToAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, 6).setValues(rowsToAppend);
  }
}

function saveDashboardSettings(values) {
  if (!values || typeof values !== "object") {
    throw new Error("No settings were supplied.");
  }

  const schema = getSettingSchema_();
  const editableFields = getEditableSettingFields_();
  const mergedValues = getDashboardSettings().values;
  const changedValues = {};

  Object.keys(values).forEach(key => {
    if (!editableFields[key]) return;
    changedValues[key] = normaliseSettingValue_(values[key], editableFields[key]);
    mergedValues[key] = changedValues[key];
  });

  const validation = validateDashboardSettings_(mergedValues, schema);
  if (!validation.ok) {
    throw new Error("Settings were not saved: " + validation.errors.join(" "));
  }

  Object.keys(changedValues).forEach(key => {
    setSetting_(key, changedValues[key]);
  });

  return getDashboardSettings();
}

function importDashboardSettingsDraft(sheetName) {
  sheetName = sheetName || "Settings Draft";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const draftSheet = ss.getSheetByName(sheetName);

  if (!draftSheet) {
    throw new Error(`Settings draft sheet '${sheetName}' not found.`);
  }

  const values = draftSheet.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error(`Settings draft sheet '${sheetName}' has no values to import.`);
  }

  const headers = values[0].map(header => String(header || "").trim().toLowerCase());

  const keyIndex = findSettingsDraftColumn_(headers, [
    "key",
    "setting",
    "setting key",
    "setting_key",
    "name"
  ]);

  const valueIndex = findSettingsDraftColumn_(headers, [
    "value",
    "setting value",
    "current value",
    "configured value",
    "setting_value"
  ]);

  if (keyIndex === -1 || valueIndex === -1) {
    throw new Error("Settings draft must include Key and Value columns, or equivalent Setting and Current Value columns.");
  }

  const editableFields = getEditableSettingFields_();
  const imported = {};
  const ignoredKeys = [];

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][keyIndex] || "").trim();
    if (!key) continue;

    if (!editableFields[key]) {
      ignoredKeys.push(key);
      continue;
    }

    imported[key] = values[i][valueIndex];
  }

  const result = saveDashboardSettings(imported);

  return {
    ok: true,
    importedCount: Object.keys(imported).length,
    ignoredKeys,
    settings: result
  };
}

function findSettingsDraftColumn_(headers, acceptedNames) {
  for (const name of acceptedNames) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }

  return -1;
}

function getEditableSettingFields_() {
  const editableFields = {};

  getSettingSchema_().forEach(section => {
    section.fields.forEach(field => {
      if (!field.readonly) editableFields[field.key] = field;
    });
  });

  return editableFields;
}

function validateDashboardSettings_(values, schema) {
  const errors = [];
  const errorsByKey = {};

  function addError(field, message) {
    errors.push(`${field.label}: ${message}`);
    if (!errorsByKey[field.key]) errorsByKey[field.key] = [];
    errorsByKey[field.key].push(message);
  }

  schema.forEach(section => {
    section.fields.forEach(field => {
      if (field.readonly) return;

      const value = values[field.key];
      const text = String(value === null || value === undefined ? "" : value).trim();

      if (field.required && !text) {
        addError(field, "required.");
        return;
      }

      if (!text) return;

      if (field.type === "email" && !isValidEmail_(text)) {
        addError(field, "enter a valid email address.");
      }

      if (field.type === "url" && !isValidUrl_(text)) {
        addError(field, "enter a valid URL starting with http:// or https://.");
      }

      if (field.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(text)) {
        addError(field, "use a hex colour like #F8F6F2.");
      }

      if (field.type === "number") {
        const n = Number(text);

        if (isNaN(n)) {
          addError(field, "enter a number.");
        } else if (field.min !== undefined && n < field.min) {
          addError(field, `must be at least ${field.min}.`);
        }
      }

      if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        addError(field, "use YYYY-MM-DD.");
      }

      if (field.type === "textarea" && field.key === "CALENDAR_ATTENDEES") {
        String(text)
          .split(/\r?\n|,/)
          .map(item => item.trim())
          .filter(Boolean)
          .forEach(email => {
            if (!isValidEmail_(email)) {
              addError(field, `${email} is not a valid email address.`);
            }
          });
      }
    });
  });

  return {
    ok: errors.length === 0,
    errors,
    errorsByKey
  };
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isValidUrl_(value) {
  return /^https?:\/\/\S+$/i.test(String(value || "").trim());
}

function testDashboardSettingsValidation() {
  const schema = getSettingSchema_();
  const defaults = {};
  const invalid = {};
  const editableFields = getEditableSettingFields_();

  schema.forEach(section => {
    section.fields.forEach(field => {
      defaults[field.key] = normaliseSettingValue_(field.fallback, field);
      invalid[field.key] = defaults[field.key];
    });
  });

  const defaultValidation = validateDashboardSettings_(defaults, schema);
  if (!defaultValidation.ok) {
    throw new Error("Default settings failed validation: " + defaultValidation.errors.join(" "));
  }

  invalid.APP_NAME = "";
  invalid.PRINTER_EMAIL = "not-an-email";
  invalid.CALENDAR_ATTENDEES = "good@example.com, bad-email";
  invalid.CALENDAR_EVENT_DURATION_MINUTES = "0";
  invalid.COLOUR_PRIMARY = "purple";
  invalid.FIKA_LOGO_URL = "not-a-url";

  const invalidValidation = validateDashboardSettings_(invalid, schema);

  const expectedKeys = [
    "APP_NAME",
    "PRINTER_EMAIL",
    "CALENDAR_ATTENDEES",
    "CALENDAR_EVENT_DURATION_MINUTES",
    "COLOUR_PRIMARY",
    "FIKA_LOGO_URL"
  ];

  expectedKeys.forEach(key => {
    if (!invalidValidation.errorsByKey[key]) {
      throw new Error("Expected validation error for " + key);
    }
  });

  if (!editableFields.APP_NAME || editableFields.LAST_INBOX_SCAN_AT) {
    throw new Error("Editable settings map did not match expected editable/read-only fields.");
  }

  return {
    ok: true,
    defaultErrorCount: defaultValidation.errors.length,
    invalidErrorCount: invalidValidation.errors.length
  };
}

function normaliseSettingValue_(value, field) {
  if (field.type === "number") {
    const n = Number(value);
    return isNaN(n) ? "" : n;
  }

  if (field.type === "textarea") {
    return String(value || "")
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean)
      .join(", ");
  }

  return String(value || "").trim();
}

function getSetting_(key, fallback) {
  if (!SETTINGS_VALUE_CACHE_) {
    SETTINGS_VALUE_CACHE_ = getSettings_();
  }

  const value = SETTINGS_VALUE_CACHE_[key];
  return value === "" || value === null || value === undefined
    ? fallback
    : value;
}

function setSetting_(key, value) {
  const sh = getSettingsSheet_();
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      SETTINGS_VALUE_CACHE_ = null;
      return;
    }
  }

  sh.appendRow([key, value]);
  SETTINGS_VALUE_CACHE_ = null;
}

function getConfiguredValue_(key, fallback) {
  const value = getSetting_(key, fallback);

  if (key === "COLOUR_PRIMARY" && String(value).trim().toUpperCase() === "#202020") {
    return fallback;
  }

  if (key === "COLOUR_SECONDARY" && String(value).trim().toUpperCase() === "#8A8A8A") {
    return fallback;
  }

  return value === "" || value === null || value === undefined ? fallback : value;
}

function getConfiguredNumber_(key, fallback) {
  const value = Number(getConfiguredValue_(key, fallback));
  return isNaN(value) ? fallback : value;
}

function verifyAdminPin(pin) {
  const expectedHash = CONFIG.ADMIN_PIN_HASH || "";
  const actualHash = hashAdminPin_(pin);

  return {
    ok: expectedHash && actualHash === expectedHash
  };
}

function hashAdminPin_(pin) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(pin || "")
  );

  return raw
    .map(byte => {
      const v = byte < 0 ? byte + 256 : byte;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}
