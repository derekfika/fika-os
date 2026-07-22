// =========================
// DATA LAYER
// =========================

const DASHBOARD_DATA_HEADERS = [
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

function getDashboardSheet_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const expectedSpreadsheetId = CONFIG.DASHBOARD_SPREADSHEET_ID || "";

  if (!ss) {
    throw new Error("No active dashboard spreadsheet was found.");
  }

  if (expectedSpreadsheetId && ss.getId() !== expectedSpreadsheetId) {
    throw new Error(
      "This dashboard script is connected to spreadsheet '" + ss.getName() +
      "' (" + ss.getId() + "), but dashboard data should be in " +
      expectedSpreadsheetId + "."
    );
  }

  const sheetName = getConfiguredValue_("SHEET_NAME", CONFIG.SHEET_NAME);
  const sh = ss.getSheetByName(sheetName);

  if (!sh) {
    throw new Error(
      `Sheet '${sheetName}' not found`
    );
  }

  ensureDashboardDataHeaders_(sh);

  return sh;
}

function ensureDashboardDataHeaders_(sh) {
  if (sh.getLastRow() > 0 && sh.getLastColumn() > 0) return false;

  sh.getRange(1, 1, 1, DASHBOARD_DATA_HEADERS.length).setValues([DASHBOARD_DATA_HEADERS]);
  sh.getRange(1, 1, 1, DASHBOARD_DATA_HEADERS.length)
    .setFontWeight("bold").setBackground("#176f8e").setFontColor("#ffffff");
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, DASHBOARD_DATA_HEADERS.length);
  return true;
}


// =========================
// HEADER MAP
// =========================

function getHeaderMap_() {

  const sh = getDashboardSheet_();

  if (sh.getLastColumn() < 1) {
    throw new Error(`Sheet '${sh.getName()}' has no dashboard headers`);
  }

  const headers = sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0];

  const map = {};

  headers.forEach((header, i) => {
    map[String(header).trim()] = i + 1;
  });

  return map;
}


// =========================
// WRITE BOOKING
// =========================

function writeBookingToSheet_(booking) {

  const sh = getDashboardSheet_();

  const map = getHeaderMap_();

  const row = sh.getLastRow() + 1;

  const values = {};

  assertRequiredHeaders_(map, [
    "BookingID",
    "Status",
    "ParsedJSON",
    "MessageId",
    "AttachmentName"
  ]);

  values.BookingID = booking.bookingId;

  values.Status = booking.status;

  values.ValidationErrors =
    booking.validationErrors.join(", ");

  values.EmailReceived =
    booking.emailReceived;

  values.MessageId =
    booking.messageId;

  values.ThreadId =
    booking.threadId;

  values.AttachmentName =
    booking.attachmentName;

  values.SourceEmailFrom =
    booking.sourceEmailFrom;

  values.SourceEmailSubject =
    booking.sourceEmailSubject;

  values.ClientCompany =
    booking.clientCompany;

  values.HostName =
    booking.hostName;

  values.HostEmail =
    booking.hostEmail;

  values.Pax =
    booking.pax;

  values.EventDate =
    booking.eventDate;

  values.ServiceTimes =
    JSON.stringify(booking.serviceTimes);

  values.ServiceType =
    booking.serviceType;

  values.Location =
    booking.location;

  values.Floor =
    booking.floor;

  values.Notes =
    booking.notes;

  values.TotalPrice =
    booking.totalPrice;

  values.MgmtFee =
    booking.mgmtFee;

  values.NetPrice =
    booking.netPrice;

  values.Vat =
    booking.vat;

  values.GrossPrice =
    booking.grossPrice;

  values.ItemsJSON =
    JSON.stringify(booking.items);

  values.ParsedJSON =
    JSON.stringify(booking);

  values.QuoteURL =
    booking.quoteUrl;

  values.QuoteCreatedAt =
    booking.quoteCreatedAt;

  values.QuotePrintedAt =
    booking.quotePrintedAt;

  values.CalendarEventId =
    booking.calendarEventId;

  values.CalendarEventURL =
    booking.calendarEventUrl;

  values.CalendarCreatedAt =
    booking.calendarCreatedAt;

  values.ManuallyEdited =
    booking.manuallyEdited;

  values.LastEditedBy =
    booking.lastEditedBy;

  values.LastEditedAt =
    booking.lastEditedAt;

  values.CreatedAt =
    booking.createdAt;

  values.UpdatedAt =
    booking.updatedAt;

  values.Error =
    booking.error;


  // Write values into correct columns

  const lastCol = sh.getLastColumn();
  const rowValues = new Array(lastCol).fill("");

  Object.keys(values).forEach(key => {
    if (!map[key]) return;
    rowValues[map[key] - 1] = values[key];
  });

  sh.getRange(row, 1, 1, lastCol).setValues([rowValues]);

}

function assertRequiredHeaders_(map, required) {
  const missing = required.filter(h => !map[h]);
  if (missing.length) {
    throw new Error("Missing dashboard headers: " + missing.join(", "));
  }
}
