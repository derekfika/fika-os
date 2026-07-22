function getDashboardBookings() {
  const sh = getDashboardSheet_();
  const data = sh.getDataRange().getValues();

  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const rows = data.slice(1);

  return rows
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map((row, index) => {
      const obj = {};

      headers.forEach((header, i) => {
        obj[header] = normaliseForClient_(row[i]);
      });

      obj.RowNumber = index + 2;

      obj.ServiceTimesParsed = safeJsonParse_(obj.ServiceTimes, []);
      obj.ItemsParsed = safeJsonParse_(obj.ItemsJSON, []);
      obj.ParsedBooking = safeJsonParse_(obj.ParsedJSON, {});

      obj.ValidationErrorsParsed = String(obj.ValidationErrors || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      return obj;
    });
}

function normaliseForClient_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (value === null || value === undefined) return "";

  return value;
}

function safeJsonParse_(value, fallback) {
  try {
    if (!value) return fallback;
    if (typeof value !== "string") return value;
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function doGet() {
  return HtmlService
    .createTemplateFromFile("Index")
    .evaluate()
    .setTitle(getConfiguredValue_("APP_NAME", CONFIG.APP_NAME))
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function updateBookingFromDashboard(rowNumber, patch, expectedBookingId) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const parsedJsonCol = map.ParsedJSON;
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

  rowNumber = resolveDashboardUpdateRow_(sh, map, rowNumber, expectedBookingId);

  const currentJson = sh.getRange(rowNumber, parsedJsonCol).getValue();
  let booking = safeJsonParse_(currentJson, null);

  if (!booking) {
    throw new Error("Could not read booking JSON for row " + rowNumber);
  }

  const oldEventDate = booking.eventDate || "";
  const oldServiceTimes = JSON.stringify(booking.serviceTimes || []);

  Object.keys(patch).forEach(key => {
    booking[key] = patch[key];
  });

  booking = recalculateDashboardTotals_(booking, 0.08);

  const newEventDate = booking.eventDate || "";
  const newServiceTimes = JSON.stringify(booking.serviceTimes || []);

  const dateOrTimeChanged =
    oldEventDate !== newEventDate ||
    oldServiceTimes !== newServiceTimes;

  booking.manuallyEdited = true;
  booking.lastEditedBy = Session.getActiveUser().getEmail();
  booking.lastEditedAt = new Date();
  booking.updatedAt = new Date();

  if (booking.quoteUrl) {
    booking.quoteStale = true;
  }

  if (
    dateOrTimeChanged &&
    (booking.calendarEventId || booking.calendarEventUrl)
  ) {
    booking.calendarStale = true;
  }

  booking = validateBooking_(booking);

  writeBookingObjectToExistingRow_(rowNumber, booking);
  const quoteRefresh = refreshQuoteAfterDashboardEdit_(rowNumber, booking, sh, map);
  booking = quoteRefresh.booking;

  return {
    ok: true,
    booking,
    quoteRegenerated: quoteRefresh.regenerated,
    quoteRegenerationError: quoteRefresh.error
  };
}

function refreshQuoteAfterDashboardEdit_(rowNumber, booking, sheet, map) {
  const result = { booking: booking, regenerated: false, error: "" };

  if (!booking.quoteUrl || (booking.validationErrors || []).length) return result;
  if (typeof generateQuoteForRow !== "function") return result;

  try {
    generateQuoteForRow(rowNumber);
    const refreshed = safeJsonParse_(sheet.getRange(rowNumber, map.ParsedJSON).getValue(), null);
    if (refreshed) result.booking = refreshed;
    result.regenerated = true;
  } catch (error) {
    result.error = error && error.message ? error.message : String(error);
    booking.quoteStale = true;
    booking.error = "Quote refresh failed: " + result.error;
    writeBookingObjectToExistingRow_(rowNumber, booking);
    result.booking = booking;
  }

  return result;
}

function recalculateDashboardTotals_(booking, managementFeeRate) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  let hasPricedItems = false;

  const totalPrice = items.reduce(function(total, item) {
    if (!item) return total;

    if (isFiniteDashboardNumber_(item.unitPrice)) {
      const qty = isFiniteDashboardNumber_(item.qty) ? Number(item.qty) : 0;
      const unitPrice = Number(item.unitPrice);
      item.lineTotal = roundMoney_(qty * unitPrice);
      hasPricedItems = true;
      return total + item.lineTotal;
    }

    if (isFiniteDashboardNumber_(item.lineTotal)) {
      hasPricedItems = true;
      return total + Number(item.lineTotal);
    }

    return total;
  }, 0);

  if (!hasPricedItems) return booking;

  const mgmtFee = totalPrice * Number(managementFeeRate || 0);
  const netPrice = totalPrice + mgmtFee;
  const vat = netPrice * 0.20;

  booking.totalPrice = roundMoney_(totalPrice);
  booking.mgmtFee = roundMoney_(mgmtFee);
  booking.netPrice = roundMoney_(netPrice);
  booking.vat = roundMoney_(vat);
  booking.grossPrice = roundMoney_(netPrice + vat);

  return booking;
}

function isFiniteDashboardNumber_(value) {
  if (value === "" || value === null || value === undefined) return false;
  return isFinite(Number(value));
}

function writeBookingObjectToExistingRow_(rowNumber, booking) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const values = {
    Status: booking.status,
    ValidationErrors: booking.validationErrors.join(", "),
    ClientCompany: booking.clientCompany,
    HostName: booking.hostName,
    HostEmail: booking.hostEmail,
    InvoiceReference: booking.invoiceReference || "",
    Pax: booking.pax,
    EventDate: booking.eventDate,
    ServiceTimes: JSON.stringify(booking.serviceTimes || []),
    ServiceType: booking.serviceType,
    Location: booking.location,
    Floor: booking.floor,
    Notes: booking.notes,
    TotalPrice: booking.totalPrice,
    MgmtFee: booking.mgmtFee,
    NetPrice: booking.netPrice,
    Vat: booking.vat,
    GrossPrice: booking.grossPrice,
    ItemsJSON: JSON.stringify(booking.items || []),
    ParsedJSON: JSON.stringify(booking),
    ManuallyEdited: booking.manuallyEdited,
    LastEditedBy: booking.lastEditedBy,
    LastEditedAt: booking.lastEditedAt,
    UpdatedAt: booking.updatedAt,
    Error: booking.error || ""
  };

  const lastCol = sh.getLastColumn();
  const currentRow = sh.getRange(rowNumber, 1, 1, lastCol).getValues()[0];

  Object.keys(values).forEach(key => {
    if (!map[key]) return;
    currentRow[map[key] - 1] = values[key];
  });

  sh.getRange(rowNumber, 1, 1, lastCol).setValues([currentRow]);

  syncBookingJsonFileIfPresent_(booking);
}

function resolveDashboardUpdateRow_(sh, map, rowNumber, expectedBookingId) {
  const requestedRow = Number(rowNumber || 0);
  const expectedId = String(expectedBookingId || "").trim();

  if (!expectedId) {
    if (requestedRow >= 2 && requestedRow <= sh.getLastRow()) return requestedRow;
    throw new Error("Could not identify the booking row to update.");
  }

  const bookingIdCol = map.BookingID;
  if (!bookingIdCol) throw new Error("BookingID column not found.");

  if (requestedRow >= 2 && requestedRow <= sh.getLastRow()) {
    const rowBookingId = String(sh.getRange(requestedRow, bookingIdCol).getValue() || "").trim();
    if (rowBookingId === expectedId) return requestedRow;
  }

  const foundRow = findDashboardRowByBookingId_(sh, map, expectedId);
  if (foundRow) return foundRow;

  throw new Error("Could not find existing booking " + expectedId + " to update.");
}

function findDashboardRowByBookingId_(sh, map, bookingId) {
  const bookingIdCol = map.BookingID;
  const parsedJsonCol = map.ParsedJSON;
  const target = String(bookingId || "").trim();
  const lastRow = sh.getLastRow();
  if (!target || lastRow < 2) return 0;

  const values = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[bookingIdCol - 1] || "").trim() === target) return i + 2;

    if (parsedJsonCol) {
      const parsed = safeJsonParse_(row[parsedJsonCol - 1], null);
      if (parsed && String(parsed.bookingId || "").trim() === target) return i + 2;
    }
  }

  return 0;
}

function syncBookingJsonFileIfPresent_(booking) {
  const fileId =
    booking.bookingJsonFileId ||
    extractDriveIdFromUrl_(booking.bookingJsonFileUrl || "");
  if (!fileId) return;

  try {
    const file = DriveApp.getFileById(fileId);
    updateBookingJsonFile_(file, booking);
  } catch (error) {
    console.warn(
      "Booking JSON file could not be updated for " +
      (booking.bookingId || "unknown booking") +
      ": " +
      error.message
    );
  }
}

function confirmBookingForRow(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  if (!booking.quoteUrl) {
    throw new Error("Cannot confirm booking before a quote has been generated.");
  }

  if (
    getConfiguredValue_("REQUIRE_CALENDAR_BEFORE_CONFIRMATION", true) &&
    !booking.calendarEventId
  ) {
    throw new Error("Cannot confirm booking before a calendar event has been created.");
  }
  const emailResult = sendBookingConfirmationEmail_(booking);

  booking.status = CONFIG.STATUS.CONFIRMED || "CONFIRMED";
  booking.confirmedAt = new Date();
  booking.confirmedBy = Session.getActiveUser().getEmail();
  booking.confirmationEmailSentAt = new Date();
  booking.confirmationEmailSentTo = emailResult.sentTo;
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return {
    ok: true,
    bookingId: booking.bookingId,
    sentTo: emailResult.sentTo
  };
}

function setBookingStatus(rowNumber, status) {
  const allowed = Object.values(CONFIG.STATUS);
  if (!allowed.includes(status)) {
    throw new Error("Invalid status: " + status);
  }

  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  booking.status = status;
  booking.updatedAt = new Date();

  if (status === CONFIG.STATUS.CONFIRMED) {
    booking.confirmedAt = new Date();
  }

  if (status === CONFIG.STATUS.CANCELLED) {
    booking.cancelledAt = new Date();
  }

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return { ok: true };
}
