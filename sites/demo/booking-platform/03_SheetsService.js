const BOOKING_HEADERS = [
  "Booking ID", "Submitted At", "Status", "Source", "Site", "Event Date", "Start Time", "End Time",
  "Guest Count", "Client Name", "Client Email", "Client Phone", "Company Name", "Floor Level",
  "Room / Area", "Net Total", "Dietary Summary", "Warnings Summary", "Booking JSON", "Processed",
  "Quote Created", "Calendar Created", "Kitchen Printed", "Internal Notes"
];

const LINE_ITEM_HEADERS = [
  "Booking ID", "Category", "Item ID", "Item Name", "Serving Info", "Unit Price", "Quantity",
  "Line Total", "Time Required", "Choices", "Comments", "Notice Required Days", "Minimum Order"
];

const SETTINGS_HEADERS = ["Key", "Value", "Section", "Label", "Notes"];

const PLATFORM_SETTINGS_ROWS = [
  ["PRIMARY_LOGO_URL", SITE_CONFIG.branding.fikaLogoUrl, "Branding", "Primary logo image URL", "Use a direct HTTPS image URL. Leave blank to show the fallback wordmark."],
  ["PRIMARY_LOGO_SVG", "", "Branding", "Primary inline SVG", "Optional inline SVG markup. If set, this is shown before the image URL or fallback wordmark."],
  ["PRIMARY_LOGO_ALT", SITE_CONFIG.branding.fikaLogoAlt, "Branding", "Primary logo alternative text", "Used for accessibility when the image is present."],
  ["PRIMARY_FALLBACK_TEXT", SITE_CONFIG.branding.fikaFallbackText, "Branding", "Primary fallback wordmark", "Shown when the image URL is blank or cannot load."],
  ["SITE_LOGO_URL", "", "Branding", "Site logo image URL", "Use a direct HTTPS image URL. Leave blank to show the fallback wordmark."],
  ["SITE_LOGO_SVG", "", "Branding", "Site inline SVG", "Optional inline SVG markup. If set, this is shown before the image URL or fallback wordmark."],
  ["SITE_LOGO_ALT", SITE_CONFIG.branding.siteLogoAlt, "Branding", "Site logo alternative text", "Used for accessibility when the image is present."],
  ["SITE_FALLBACK_TEXT", SITE_CONFIG.branding.siteFallbackText, "Branding", "Site fallback wordmark", "Shown when the image URL is blank or cannot load."],
  ["CLIENT_FACING_NAME", SITE_CONFIG.clientFacingName, "Copy", "Browser and platform name", "The client-facing name of the booking platform."],
  ["BRAND_EYEBROW", SITE_CONFIG.branding.eyebrow, "Copy", "Hero eyebrow", "Small heading above the main title."],
  ["HERO_TITLE", SITE_CONFIG.branding.heroTitle, "Copy", "Hero title", "Main booking page headline."],
  ["HERO_BODY", SITE_CONFIG.branding.heroBody, "Copy", "Hero body copy", "Short introduction below the headline."],
  ["COLOUR_ACCENT", SITE_CONFIG.branding.accent, "Colours", "Primary brand colour", "Hex colour such as #3d21bf."],
  ["COLOUR_INK", SITE_CONFIG.branding.ink, "Colours", "Text colour", "Hex colour such as #221874."],
  ["COLOUR_PAPER", SITE_CONFIG.branding.paper, "Colours", "Page background colour", "Hex colour such as #f4f4f2."],
  ["SITE_EMAIL_ADDRESS", SITE_CONFIG.siteEmailAddress, "Notifications", "Site manager email", "Primary notification inbox for this site. Change this when forking the platform for another location."],
  ["NOTIFICATION_RECIPIENTS", "", "Notifications", "Additional booking recipients", "Optional comma, semicolon or line-separated CC-style recipients."],
  ["DASHBOARD_URL", "", "Notifications", "Hospitality dashboard URL", "Optional deployed dashboard URL included in the notification email."],
  ["FEEDBACK_WEB_APP_URL", SITE_CONFIG.feedback.webAppUrl, "Feedback", "Feedback portal URL", "Shared feedback portal /exec URL used for feedback preview links."],
  ["DEMO_FEEDBACK_RECIPIENT", SITE_CONFIG.feedback.recipient, "Feedback", "Feedback recipient", "Feedback preview links are sent here immediately after a booking is submitted."]
];

const DASHBOARD_REQUIRED_HEADERS = [
  "BookingID", "Status", "ValidationErrors", "ClientCompany", "HostName", "HostEmail", "Pax",
  "EventDate", "ServiceTimes", "ServiceType", "Location", "Floor", "Notes", "TotalPrice",
  "MgmtFee", "NetPrice", "Vat", "GrossPrice", "ItemsJSON", "ParsedJSON"
];

const DASHBOARD_HEADERS = [
  "BookingID", "Status", "ValidationErrors", "EmailReceived", "MessageId", "ThreadId",
  "AttachmentName", "SourceEmailFrom", "SourceEmailSubject", "ClientCompany", "HostName",
  "HostEmail", "InvoiceReference", "Pax", "EventDate", "ServiceTimes", "ServiceType",
  "Location", "Floor", "Notes", "TotalPrice", "MgmtFee", "NetPrice", "Vat", "GrossPrice",
  "ItemsJSON", "ParsedJSON", "QuoteURL", "QuoteCreatedAt", "QuotePrintedAt",
  "CalendarEventId", "CalendarEventURL", "CalendarCreatedAt", "ManuallyEdited",
  "LastEditedBy", "LastEditedAt", "CreatedAt", "UpdatedAt", "Error", "QuoteStale",
  "CalendarStale", "CalendarRemovedAt", "CancelledAt", "CancelledBy",
  "CancellationEmailSentAt"
];

function setupBookingPlatformSheets() {
  const spreadsheet = getBookingSpreadsheet_();
  const dashboardSpreadsheet = getDashboardSpreadsheet_();
  const result = { ok: true, sheets: [] };

  if (SITE_CONFIG.integration.keepClientRequestLog) {
    const requests = getOrCreateSheet_(spreadsheet, SITE_CONFIG.sheets.bookingRequests, BOOKING_HEADERS);
    requests.setFrozenRows(1);
    result.sheets.push(requests.getName());
  }

  const lines = getOrCreateSheet_(spreadsheet, SITE_CONFIG.sheets.bookingLineItems, LINE_ITEM_HEADERS);
  lines.setFrozenRows(1);
  result.sheets.push(lines.getName());

  const settings = setupPlatformSettingsSheet_(spreadsheet);
  result.sheets.push(settings.getName());

  const dashboard = getDashboardDataSheet_(dashboardSpreadsheet);
  const dashboardWasInitialised = ensureDashboardHeaders_(dashboard);
  const map = getSheetHeaderMap_(dashboard);
  assertHeaders_(map, DASHBOARD_REQUIRED_HEADERS, dashboard.getName());
  result.dashboardSpreadsheet = dashboardSpreadsheet.getName();
  result.dashboardSheet = dashboard.getName();
  result.dashboardInitialised = dashboardWasInitialised;
  return result;
}

function setupPlatformSettingsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(SITE_CONFIG.sheets.settings);
  if (!sheet) sheet = spreadsheet.insertSheet(SITE_CONFIG.sheets.settings);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length).setValues([SETTINGS_HEADERS]);
  }
  const existingKeys = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().map(function(row) { return row[0]; })
    : [];
  const missingRows = PLATFORM_SETTINGS_ROWS.filter(function(row) { return existingKeys.indexOf(row[0]) === -1; });
  if (missingRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missingRows.length, SETTINGS_HEADERS.length).setValues(missingRows);
  }
  const legacyLogoPlaceholder = ["YOUR", "LOGO", "HERE"].join(" ");
  const legacyClientName = ["De", "mo Hospitality"].join("");
  updateLegacyDemoSetting_(sheet, "SITE_EMAIL_ADDRESS", "demo@example.com", SITE_CONFIG.siteEmailAddress);
  updateLegacyDemoSetting_(sheet, "PRIMARY_LOGO_URL", "", SITE_CONFIG.branding.fikaLogoUrl);
  updateLegacyDemoSetting_(sheet, "PRIMARY_LOGO_ALT", ["De", "mo hospitality"].join(""), SITE_CONFIG.branding.fikaLogoAlt);
  updateLegacyDemoSetting_(sheet, "PRIMARY_FALLBACK_TEXT", "Hospitality", SITE_CONFIG.branding.fikaFallbackText);
  updateLegacyDemoSetting_(sheet, "SITE_LOGO_ALT", "Your logo here", SITE_CONFIG.branding.siteLogoAlt);
  updateLegacyDemoSetting_(sheet, "SITE_FALLBACK_TEXT", legacyLogoPlaceholder, SITE_CONFIG.branding.siteFallbackText);
  updateLegacyDemoSetting_(sheet, "CLIENT_FACING_NAME", legacyClientName, SITE_CONFIG.clientFacingName);
  updateLegacyDemoSetting_(sheet, "BRAND_EYEBROW", ["De", "mo hospitality booking platform"].join(""), SITE_CONFIG.branding.eyebrow);
  updateLegacyDemoSetting_(sheet, "HERO_TITLE", "Hospitality, simply arranged.", SITE_CONFIG.branding.heroTitle);
  updateLegacyDemoSetting_(sheet, "COLOUR_ACCENT", "#4f5d64", SITE_CONFIG.branding.accent);
  updateLegacyDemoSetting_(sheet, "COLOUR_INK", "#243036", SITE_CONFIG.branding.ink);
  updateLegacyDemoSetting_(sheet, "COLOUR_PAPER", "#f4f3ef", SITE_CONFIG.branding.paper);
  sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length)
    .setFontWeight("bold").setBackground("#3d21bf").setFontColor("#ffffff");
  if (sheet.getLastRow() > 1) sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setBackground("#e9fbf5");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, SETTINGS_HEADERS.length);
  sheet.setColumnWidth(2, 340);
  sheet.setColumnWidth(5, 420);
  return sheet;
}

function updateLegacyDemoSetting_(sheet, key, legacyValue, replacementValue) {
  if (sheet.getLastRow() < 2) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  for (let index = 0; index < rows.length; index++) {
    if (
      String(rows[index][0] || "").trim() === key &&
      String(rows[index][1] || "").trim().toLowerCase() === String(legacyValue).toLowerCase()
    ) {
      sheet.getRange(index + 2, 2).setValue(replacementValue);
      return;
    }
  }
}

function writeBookingRequest_(booking) {
  if (SITE_CONFIG.integration.mode !== "direct_dashboard") {
    throw new Error("Unsupported booking integration mode: " + SITE_CONFIG.integration.mode);
  }

  const spreadsheet = getBookingSpreadsheet_();
  const dashboardSpreadsheet = getDashboardSpreadsheet_();
  const dashboardSheet = getDashboardDataSheet_(dashboardSpreadsheet);
  const lineSheet = getOrCreateSheet_(spreadsheet, SITE_CONFIG.sheets.bookingLineItems, LINE_ITEM_HEADERS);
  const dashboardBooking = adaptClientBookingForDashboard_(booking);
  const dashboardRow = appendDashboardBooking_(dashboardSheet, dashboardBooking);
  const firstLineItemRow = lineSheet.getLastRow() + 1;
  let lineItemRowsWritten = 0;

  try {
    appendClientLineItems_(lineSheet, booking);
    lineItemRowsWritten = booking.order.items.length;
    if (SITE_CONFIG.integration.keepClientRequestLog) {
      appendClientRequestLog_(getOrCreateSheet_(spreadsheet, SITE_CONFIG.sheets.bookingRequests, BOOKING_HEADERS), booking);
    }
  } catch (error) {
    if (lineItemRowsWritten) lineSheet.deleteRows(firstLineItemRow, lineItemRowsWritten);
    dashboardSheet.deleteRow(dashboardRow);
    throw error;
  }

  return {
    dashboardRow: dashboardRow,
    dashboardStatus: dashboardBooking.status,
    dashboardBooking: dashboardBooking
  };
}

function adaptClientBookingForDashboard_(booking) {
  const subtotal = roundMoney_(booking.order.netTotal);
  const managementFee = roundMoney_(subtotal * Number(SITE_CONFIG.integration.managementFeeRate || 0));
  const netPrice = roundMoney_(subtotal + managementFee);
  const vat = roundMoney_(netPrice * Number(SITE_CONFIG.integration.vatRate || 0));
  const grossPrice = roundMoney_(netPrice + vat);
  const serviceType = eventTypeLabel_(booking.order.eventType);
  const serviceTimes = unique_(booking.order.items.map(function(item) {
    return item.timeRequired || booking.event.startTime;
  }).filter(Boolean));
  if (!serviceTimes.length && booking.event.startTime) serviceTimes.push(booking.event.startTime);

  const dashboardItems = booking.order.items.map(function(item) {
    const choiceText = item.choices.filter(function(choice) { return hasChoiceValue_(choice.value); })
      .map(function(choice) { return choice.label + ": " + formatChoiceValue_(choice.value); }).join("; ");
    return {
      section: item.category,
      name: item.itemName,
      detail: choiceText,
      info: item.description || item.servingInfo,
      qty: item.quantity,
      time: item.timeRequired || booking.event.startTime,
      comment: item.comments,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      itemId: item.itemId
    };
  });

  const notes = buildDashboardNotes_(booking);
  const validationErrors = [];
  if (!booking.client.companyName) validationErrors.push("Missing company");
  if (!booking.event.eventDate) validationErrors.push("Missing event date");
  if (!serviceTimes.length) validationErrors.push("Missing service time");
  if (!booking.event.guestCount) validationErrors.push("Missing pax");
  if (!dashboardItems.length) validationErrors.push("Missing line items");
  if (subtotal <= 0) validationErrors.push("Missing total price");
  return {
    bookingId: booking.bookingId,
    status: validationErrors.length ? "NEEDS_REVIEW" : "READY",
    validationErrors: validationErrors,
    emailReceived: booking.submittedAt,
    messageId: "CLIENT:" + booking.bookingId,
    threadId: "",
    attachmentName: "client-booking-" + booking.bookingId + ".json",
    sourceEmailFrom: booking.client.email,
    sourceEmailSubject: "Client booking request " + booking.bookingId,
    source: booking.source,
    sourceType: "CLIENT_PLATFORM",
    clientCompany: booking.client.companyName,
    hostName: booking.client.name,
    hostEmail: booking.client.email,
    hostPhone: booking.client.phone,
    invoiceReference: booking.client.invoiceReference || "",
    pax: booking.event.guestCount,
    eventDate: booking.event.eventDate,
    serviceTimes: serviceTimes,
    serviceType: serviceType,
    location: SITE_CONFIG.address,
    floor: booking.event.floorLevel,
    notes: notes,
    totalPrice: subtotal,
    mgmtFee: managementFee,
    netPrice: netPrice,
    vat: vat,
    grossPrice: grossPrice,
    items: dashboardItems,
    clientBooking: booking,
    quoteUrl: "",
    quoteCreatedAt: "",
    quotePrintedAt: "",
    calendarEventId: "",
    calendarEventUrl: "",
    calendarCreatedAt: "",
    manuallyEdited: false,
    lastEditedBy: "",
    lastEditedAt: "",
    createdAt: booking.submittedAt,
    updatedAt: booking.submittedAt,
    error: "",
    quoteStale: false,
    calendarStale: false
  };
}

function hasChoiceValue_(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function formatChoiceValue_(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function appendDashboardBooking_(sheet, booking) {
  const map = getSheetHeaderMap_(sheet);
  assertHeaders_(map, DASHBOARD_REQUIRED_HEADERS, sheet.getName());
  assertDashboardBookingIdIsUnique_(sheet, map, booking.bookingId);

  const values = {
    BookingID: booking.bookingId,
    Status: booking.status,
    ValidationErrors: booking.validationErrors.join(", "),
    EmailReceived: new Date(booking.emailReceived),
    MessageId: booking.messageId,
    ThreadId: booking.threadId,
    AttachmentName: booking.attachmentName,
    SourceEmailFrom: booking.sourceEmailFrom,
    SourceEmailSubject: booking.sourceEmailSubject,
    ClientCompany: booking.clientCompany,
    HostName: booking.hostName,
    HostEmail: booking.hostEmail,
    InvoiceReference: booking.invoiceReference,
    Pax: booking.pax,
    EventDate: booking.eventDate,
    ServiceTimes: JSON.stringify(booking.serviceTimes),
    ServiceType: booking.serviceType,
    Location: booking.location,
    Floor: booking.floor,
    Notes: booking.notes,
    TotalPrice: booking.totalPrice,
    MgmtFee: booking.mgmtFee,
    NetPrice: booking.netPrice,
    Vat: booking.vat,
    GrossPrice: booking.grossPrice,
    ItemsJSON: JSON.stringify(booking.items),
    ParsedJSON: JSON.stringify(booking),
    QuoteURL: "",
    QuoteCreatedAt: "",
    QuotePrintedAt: "",
    CalendarEventId: "",
    CalendarEventURL: "",
    CalendarCreatedAt: "",
    ManuallyEdited: false,
    LastEditedBy: "",
    LastEditedAt: "",
    CreatedAt: new Date(booking.createdAt),
    UpdatedAt: new Date(booking.updatedAt),
    Error: ""
  };

  const rowNumber = sheet.getLastRow() + 1;
  const row = new Array(sheet.getLastColumn()).fill("");
  Object.keys(values).forEach(function(header) {
    if (map[header]) row[map[header] - 1] = values[header];
  });
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  return rowNumber;
}

function appendClientLineItems_(sheet, booking) {
  if (!booking.order.items.length) return;
  const rows = booking.order.items.map(function(item) {
    return [
      booking.bookingId, item.category, item.itemId, item.itemName, item.servingInfo,
      item.unitPrice, item.quantity, item.lineTotal, item.timeRequired, JSON.stringify(item.choices),
      item.comments, item.noticeRequiredDays, item.minimumOrder
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LINE_ITEM_HEADERS.length).setValues(rows);
}

function appendClientRequestLog_(sheet, booking) {
  sheet.appendRow([
    booking.bookingId, new Date(booking.submittedAt), booking.status, booking.source, booking.site,
    booking.event.eventDate, booking.event.startTime, booking.event.endTime, booking.event.guestCount,
    booking.client.name, booking.client.email, booking.client.phone, booking.client.companyName,
    booking.event.floorLevel, booking.event.roomOrArea || booking.event.deliveryPoint, booking.order.netTotal,
    dietarySummary_(booking.dietaries), warningSummary_(booking.warnings), JSON.stringify(booking),
    false, false, false, false, ""
  ]);
}

function getBookingSpreadsheet_() {
  const propertyId = PropertiesService.getScriptProperties()
    .getProperty("BOOKING_SPREADSHEET_ID");
  const configuredValue = SITE_CONFIG.integration.bookingSpreadsheetId || propertyId;
  const id = extractSpreadsheetId_(configuredValue);

  if (configuredValue && !id) {
    throw new Error(
      "The configured booking platform spreadsheet value is not a valid spreadsheet ID or Google Sheets URL. " +
      "Use the value between /d/ and /edit, not the tab gid."
    );
  }

  if (id) return SpreadsheetApp.openById(id);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      "No booking platform spreadsheet is configured. Run setBookingSpreadsheetId('YOUR_BOOKING_PLATFORM_SPREADSHEET_ID') once."
    );
  }
  return active;
}

function getDashboardSpreadsheet_() {
  const propertyId = PropertiesService.getScriptProperties()
    .getProperty("DASHBOARD_SPREADSHEET_ID");
  const configuredValue =
    SITE_CONFIG.integration.dashboardSpreadsheetId ||
    propertyId ||
    SITE_CONFIG.integration.spreadsheetId;
  const id = extractSpreadsheetId_(configuredValue);

  if (configuredValue && !id) {
    throw new Error(
      "The configured dashboard spreadsheet value is not a valid spreadsheet ID or Google Sheets URL. " +
      "Use the value between /d/ and /edit, not the tab gid."
    );
  }

  if (!id) {
    throw new Error(
      "No dashboard spreadsheet is configured. Run setDashboardSpreadsheetId('YOUR_DASHBOARD_SPREADSHEET_ID') once."
    );
  }

  return SpreadsheetApp.openById(id);
}

function getDashboardDataSheet_(spreadsheet) {
  const name = SITE_CONFIG.integration.dashboardSheetName;
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    const available = spreadsheet.getSheets()
      .map(function(candidate) { return candidate.getName(); })
      .join(", ");
    throw new Error(
      "Dashboard sheet '" + name + "' was not found in spreadsheet '" +
      spreadsheet.getName() + "'. Available tabs: " + (available || "none") +
      ". Run testBookingPlatformConnection() for connection details."
    );
  }
  return sheet;
}

function extractSpreadsheetId_(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return "";
}

/**
 * Connects this booking platform to its own data spreadsheet.
 * Pass either the full Google Sheets URL or the spreadsheet ID between /d/ and /edit.
 */
function setBookingSpreadsheetId(value) {
  const id = extractSpreadsheetId_(value);
  if (!id) {
    throw new Error(
      "Invalid spreadsheet value. Paste the full Google Sheets URL or the spreadsheet ID between /d/ and /edit."
    );
  }

  SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties()
    .setProperty("BOOKING_SPREADSHEET_ID", id);

  return testBookingPlatformConnection();
}

function clearBookingSpreadsheetId() {
  PropertiesService.getScriptProperties()
    .deleteProperty("BOOKING_SPREADSHEET_ID");
  return { ok: true };
}

/**
 * Connects this booking platform to the hospitality dashboard spreadsheet.
 * Pass either the full Google Sheets URL or the spreadsheet ID between /d/ and /edit.
 */
function setDashboardSpreadsheetId(value) {
  const id = extractSpreadsheetId_(value);
  if (!id) {
    throw new Error(
      "Invalid spreadsheet value. Paste the full Google Sheets URL or the spreadsheet ID between /d/ and /edit."
    );
  }

  SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties()
    .setProperty("DASHBOARD_SPREADSHEET_ID", id);

  return testBookingPlatformConnection();
}

function clearDashboardSpreadsheetId() {
  PropertiesService.getScriptProperties()
    .deleteProperty("DASHBOARD_SPREADSHEET_ID");
  return { ok: true };
}

function testBookingPlatformConnection() {
  const bookingSpreadsheet = getBookingSpreadsheet_();
  const dashboardSpreadsheet = getDashboardSpreadsheet_();
  const bookingTabs = bookingSpreadsheet.getSheets()
    .map(function(sheet) { return sheet.getName(); });
  const dashboardTabs = dashboardSpreadsheet.getSheets()
    .map(function(sheet) { return sheet.getName(); });
  const expectedTab = SITE_CONFIG.integration.dashboardSheetName;
  const dashboardFound = dashboardTabs.indexOf(expectedTab) !== -1;
  const bookingHasSettings = bookingTabs.indexOf(SITE_CONFIG.sheets.settings) !== -1;
  const bookingHasLineItems = bookingTabs.indexOf(SITE_CONFIG.sheets.bookingLineItems) !== -1;

  return {
    ok: dashboardFound,
    bookingSpreadsheetId: bookingSpreadsheet.getId(),
    bookingSpreadsheetName: bookingSpreadsheet.getName(),
    bookingTabs: bookingTabs,
    bookingHasSettings: bookingHasSettings,
    bookingHasLineItems: bookingHasLineItems,
    dashboardSpreadsheetId: dashboardSpreadsheet.getId(),
    dashboardSpreadsheetName: dashboardSpreadsheet.getName(),
    expectedDashboardTab: expectedTab,
    dashboardTabs: dashboardTabs,
    message: dashboardFound
      ? "Booking data uses '" + bookingSpreadsheet.getName() + "'. Dashboard writes to '" +
        dashboardSpreadsheet.getName() + "' and found '" + expectedTab + "'."
      : "Dashboard target '" + dashboardSpreadsheet.getName() + "' does not contain '" +
        expectedTab + "'. Available tabs: " + dashboardTabs.join(", ")
  };
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#3d21bf").setFontColor("#ffffff");
  }
  return sheet;
}

function getSheetHeaderMap_(sheet) {
  if (sheet.getLastColumn() < 1) {
    throw new Error(
      "Sheet '" + sheet.getName() + "' has no headers. Run setupBookingPlatformSheets() to initialise an empty Dashboard Data tab, or add the dashboard headers first."
    );
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function(header, index) { map[String(header).trim()] = index + 1; });
  return map;
}

function ensureDashboardHeaders_(sheet) {
  if (sheet.getLastRow() > 0 && sheet.getLastColumn() > 0) return false;

  sheet.getRange(1, 1, 1, DASHBOARD_HEADERS.length).setValues([DASHBOARD_HEADERS]);
  sheet.getRange(1, 1, 1, DASHBOARD_HEADERS.length)
    .setFontWeight("bold").setBackground("#176f8e").setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, DASHBOARD_HEADERS.length);
  return true;
}

function assertHeaders_(map, required, sheetName) {
  const missing = required.filter(function(header) { return !map[header]; });
  if (missing.length) throw new Error("Sheet '" + sheetName + "' is missing headers: " + missing.join(", "));
}

function assertDashboardBookingIdIsUnique_(sheet, map, bookingId) {
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, map.BookingID, sheet.getLastRow() - 1, 1).getDisplayValues();
  if (values.some(function(row) { return row[0] === bookingId; })) {
    throw new Error("Booking " + bookingId + " already exists in the dashboard.");
  }
}

function buildDashboardNotes_(booking) {
  const dietary = dietarySummary_(booking.dietaries);
  return [
    "Submitted through Client Booking Platform.",
    booking.specialInstructions ? "Special instructions: " + booking.specialInstructions : "",
    booking.client.invoiceReference ? "Invoice reference: " + booking.client.invoiceReference : "",
    booking.event.roomOrArea ? "Room / area: " + booking.event.roomOrArea : "",
    booking.event.deliveryPoint ? "Delivery point: " + booking.event.deliveryPoint : "",
    dietary !== "None declared" ? "Dietaries: " + dietary : "Dietaries: None declared",
    booking.dietaries.allergyDetails ? "ALLERGIES: " + booking.dietaries.allergyDetails : "",
    warningSummary_(booking.warnings) ? "Warnings: " + warningSummary_(booking.warnings) : "",
    booking.event.onsiteContactName ? "Onsite contact: " + booking.event.onsiteContactName + " " + booking.event.onsiteContactPhone : ""
  ].filter(Boolean).join("\n");
}

function eventTypeLabel_(id) {
  const type = EVENT_TYPES.find(function(candidate) { return candidate.id === id; });
  return type ? type.label : id;
}

function unique_(values) {
  return values.filter(function(value, index) { return values.indexOf(value) === index; });
}

function dietarySummary_(dietaries) {
  if (!dietaries.hasDietaries && !dietaries.allergyDetails) return "None declared";
  return [
    "Vegetarian " + dietaries.vegetarian, "Vegan " + dietaries.vegan,
    "Gluten-free " + dietaries.glutenFree, "Coeliac " + dietaries.coeliac,
    "Dairy-free " + dietaries.dairyFree, "Halal " + dietaries.halal,
    "Other " + dietaries.otherCount
  ].join(" · ");
}

function warningSummary_(warnings) {
  const output = [];
  if (warnings.inside72Hours) output.push("Inside 72 hours");
  if (warnings.inside10WorkingDays) output.push("Inside 10 working days");
  if (warnings.insideDietaryDeadline) output.push("Inside dietary deadline");
  return output.concat(warnings.minimumOrderIssues, warnings.dietaryCountIssues, warnings.itemNoticeIssues).join(" · ");
}
