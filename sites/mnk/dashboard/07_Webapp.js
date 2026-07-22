function getDashboardBookings() {
  runAutoArchiveIfEnabled_();

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

function updateBookingFromDashboard(rowNumber, patch) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const parsedJsonCol = map.ParsedJSON;
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

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

  booking = applyMnkDeliveryCharge_(booking);

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

function applyMnkDeliveryCharge_(booking) {
  const deliveryRequired = booking.deliveryChargeRequired === true;
  const existingItems = Array.isArray(booking.items) ? booking.items : [];
  const existingDelivery = existingItems.find(function(item) {
    return item && item.itemId === "mnk_cpu_delivery_charge";
  });
  const existingDeliveryAmount = existingDelivery
    ? Number(existingDelivery.lineTotal || existingDelivery.unitPrice || 35)
    : Number((booking.charges && booking.charges.delivery && booking.charges.delivery.amount) || 0);
  const fallbackFoodSubtotal = getMnkFoodSubtotalFallback_(booking, existingDeliveryAmount);
  const baseItems = existingItems.filter(function(item) {
    return !(item && item.itemId === "mnk_cpu_delivery_charge");
  });

  const charges = booking.charges && typeof booking.charges === "object"
    ? booking.charges
    : {};

  if (deliveryRequired) {
    baseItems.push({
      section: "Delivery",
      name: "CPU delivery charge",
      detail: "One-way delivery from CPU",
      info: "£35 ex VAT",
      qty: 1,
      time: "",
      comment: "",
      unitPrice: 35,
      lineTotal: 35,
      itemId: "mnk_cpu_delivery_charge"
    });
  }

  charges.delivery = {
    enabled: deliveryRequired,
    label: "CPU delivery charge",
    amount: deliveryRequired ? 35 : 0,
    vatStatus: "ex_vat",
    direction: "one_way"
  };

  booking.items = baseItems;
  booking.charges = charges;
  booking.deliveryChargeRequired = deliveryRequired;

  return recalculateMnkDashboardTotals_(booking, fallbackFoodSubtotal);
}

function getMnkFoodSubtotalFallback_(booking, existingDeliveryAmount) {
  const totalPrice = Number(booking.totalPrice || 0);
  const mgmtFee = Number(booking.mgmtFee || 0);
  const netPrice = Number(booking.netPrice || 0);
  const deliveryAmount = Number(existingDeliveryAmount || 0);

  if (mgmtFee > 0 && netPrice > 0) {
    return Math.max(0, roundMoney_(netPrice - mgmtFee - deliveryAmount));
  }

  return Math.max(0, roundMoney_(totalPrice - deliveryAmount));
}

function recalculateMnkDashboardTotals_(booking, fallbackFoodSubtotal) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const foodItems = items.filter(function(item) {
    return !(item && item.itemId === "mnk_cpu_delivery_charge");
  });
  const hasPricedFoodItems = foodItems.some(function(item) {
    return isFiniteDashboardNumber_(item.unitPrice) || isFiniteDashboardNumber_(item.lineTotal);
  });
  const foodSubtotal = hasPricedFoodItems
    ? foodItems.reduce(function(total, item) {
      if (isFiniteDashboardNumber_(item.unitPrice)) {
        const qty = isFiniteDashboardNumber_(item.qty) ? Number(item.qty) : 0;
        const unitPrice = Number(item.unitPrice);
        item.lineTotal = roundMoney_(qty * unitPrice);
        return total + item.lineTotal;
      }

      const lineTotal = isFiniteDashboardNumber_(item.lineTotal) ? Number(item.lineTotal) : 0;
      return total + lineTotal;
    }, 0)
    : Number(fallbackFoodSubtotal || 0);
  const deliverySubtotal = booking.deliveryChargeRequired ? 35 : 0;
  const totalPrice = foodSubtotal + deliverySubtotal;

  const mgmtFee = 0;
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
    QuoteURL: booking.quoteUrl || "",
    QuoteCreatedAt: booking.quoteCreatedAt || "",
    QuotePrintedAt: booking.quotePrintedAt || "",
    CalendarEventId: booking.calendarEventId || "",
    CalendarEventURL: booking.calendarEventUrl || "",
    CalendarCreatedAt: booking.calendarCreatedAt || "",
    ManuallyEdited: booking.manuallyEdited,
    LastEditedBy: booking.lastEditedBy,
    LastEditedAt: booking.lastEditedAt,
    QuoteStale: booking.quoteStale === true,
    CalendarStale: booking.calendarStale === true,
    CalendarRemovedAt: booking.calendarRemovedAt || "",
    CancelledAt: booking.cancelledAt || "",
    CancelledBy: booking.cancelledBy || "",
    CancellationEmailSentAt: booking.cancellationEmailSentAt || "",
    RechargeSyncedAt: booking.rechargeSyncedAt || "",
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
