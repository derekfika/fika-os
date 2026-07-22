// =========================
// DATA LAYER
// =========================

function getDashboardSheet_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetName = getConfiguredValue_("SHEET_NAME", CONFIG.SHEET_NAME);
  const sh = ss.getSheetByName(sheetName);

  if (!sh) {
    throw new Error(
      `Sheet '${sheetName}' not found`
    );
  }

  return sh;
}


// =========================
// HEADER MAP
// =========================

function getHeaderMap_() {

  const sh = getDashboardSheet_();

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

  const values = {};

  assertRequiredHeaders_(map, [
    "BookingID",
    "Status",
    "ParsedJSON",
    "MessageId",
    "AttachmentName"
  ]);

  const existingRow = findDashboardRowBySourceKey_(booking.messageId, booking.attachmentName, sh, map);
  if (existingRow) {
    return existingRow;
  }

  const row = sh.getLastRow() + 1;

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

  return row;
}

function assertRequiredHeaders_(map, required) {
  const missing = required.filter(h => !map[h]);
  if (missing.length) {
    throw new Error("Missing dashboard headers: " + missing.join(", "));
  }
}

function findDashboardRowBySourceKey_(messageId, attachmentName, sh, map) {
  const cleanMessageId = String(messageId || "").trim();
  const cleanAttachmentName = String(attachmentName || "").trim();
  if (!cleanMessageId || !cleanAttachmentName) return 0;

  sh = sh || getDashboardSheet_();
  map = map || getHeaderMap_();

  const messageCol = map.MessageId;
  const attachmentCol = map.AttachmentName;
  if (!messageCol || !attachmentCol) return 0;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowMessageId = String(row[messageCol - 1] || "").trim();
    const rowAttachmentName = String(row[attachmentCol - 1] || "").trim();

    if (rowMessageId === cleanMessageId && rowAttachmentName === cleanAttachmentName) {
      return i + 2;
    }
  }

  return 0;
}
