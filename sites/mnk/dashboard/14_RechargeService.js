function syncConfirmedBookingsToRechargeSheet() {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    return { ok: true, checked: 0, synced: 0, skipped: 0, rows: [] };
  }

  const parsedJsonCol = map.ParsedJSON;
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

  const rechargeSheet = getRechargeSheet_();
  const target = getRechargeTarget_(rechargeSheet);
  const syncedRows = [];
  const skippedRows = [];
  let checked = 0;
  let skipped = 0;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const json = sh.getRange(rowNumber, parsedJsonCol).getValue();
    let booking = safeJsonParse_(json, null);
    if (!booking) {
      skipped++;
      continue;
    }

    checked++;

    const skipReason = getRechargeSkipReason_(booking);
    if (skipReason) {
      skipped++;
      skippedRows.push({
        rowNumber: rowNumber,
        bookingId: booking.bookingId || "",
        status: booking.status || "",
        eventDate: booking.eventDate || "",
        reason: skipReason
      });
      continue;
    }

    const rowData = buildRechargeRow_(booking);
    const writeRow = getNextRechargeWriteRow_(rechargeSheet, target);

    rechargeSheet.getRange(writeRow, target.dateCol).setValue(rowData.date);
    rechargeSheet.getRange(writeRow, target.detailCol).setValue(rowData.description);
    rechargeSheet.getRange(writeRow, target.amountCol).setValue(rowData.net);
    rechargeSheet.getRange(writeRow, target.dateCol).setNumberFormat("dd/mm/yyyy");
    rechargeSheet.getRange(writeRow, target.amountCol).setNumberFormat("£#,##0.00");

    booking.status = CONFIG.STATUS.RECHARGED || "RECHARGED";
    booking.rechargeSyncedAt = new Date();
    booking.rechargeSpreadsheetId = getConfiguredValue_(
      "RECHARGE_SPREADSHEET_ID",
      CONFIG.RECHARGE_SPREADSHEET_ID
    );
    booking.rechargeSheetName = rechargeSheet.getName();
    booking.updatedAt = new Date();

    writeBookingObjectToExistingRow_(rowNumber, booking);

    syncedRows.push({
      rowNumber: rowNumber,
      bookingId: booking.bookingId || "",
      rechargeRow: writeRow,
      net: rowData.net
    });
  }

  return {
    ok: true,
    checked: checked,
    synced: syncedRows.length,
    skipped: skipped,
    rows: syncedRows,
    skippedRows: skippedRows.slice(0, 25)
  };
}

function shouldSyncBookingToRecharge_(booking) {
  return !getRechargeSkipReason_(booking);
}

function getRechargeSkipReason_(booking) {
  const status = String(booking.status || "").toUpperCase();
  const syncableStatuses = [
    CONFIG.STATUS.CPU_CREATED,
    CONFIG.STATUS.CONFIRMED,
    CONFIG.STATUS.ARCHIVED
  ];
  if (syncableStatuses.indexOf(status) === -1) return "Status is not calendar-created, confirmed or archived";
  if (booking.rechargeSyncedAt) return "Already recharged";
  if (!isBookingCompleteForRecharge_(booking)) return "Event date is not before today";
  if (Number(booking.netPrice || 0) <= 0) return "Missing net total";

  return "";
}

function isBookingCompleteForRecharge_(booking) {
  const eventDate = parseRechargeDate_(booking.eventDate);
  if (!eventDate || Object.prototype.toString.call(eventDate) !== "[object Date]") {
    return false;
  }

  if (isNaN(eventDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  eventDate.setHours(0, 0, 0, 0);

  return eventDate < today;
}

function getRechargeSheet_() {
  const spreadsheetId = String(
    getConfiguredValue_("RECHARGE_SPREADSHEET_ID", CONFIG.RECHARGE_SPREADSHEET_ID)
  ).trim();
  const sheetName = String(
    getConfiguredValue_("RECHARGE_SHEET_NAME", CONFIG.RECHARGE_SHEET_NAME)
  ).trim();

  if (!spreadsheetId) throw new Error("Recharge sheet ID is blank in Settings.");
  if (!sheetName) throw new Error("Recharge tab name is blank in Settings.");

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const wanted = sheetName.toLowerCase();
  const sheet = ss.getSheets().find(function(candidate) {
    return candidate.getName().toLowerCase() === wanted;
  });

  if (!sheet) {
    throw new Error(
      "Recharge tab '" +
      sheetName +
      "' was not found in spreadsheet '" +
      ss.getName() +
      "'."
    );
  }

  return sheet;
}

function getRechargeTarget_(sheet) {
  const headerRow = findRechargeHeaderRow_(sheet);
  const lastCol = Math.max(sheet.getLastColumn(), 3);
  const headers = sheet
    .getRange(headerRow, 1, 1, lastCol)
    .getValues()[0]
    .map(function(value) {
      return String(value || "").trim().toLowerCase();
    });

  const dateCol = findHeaderColumn_(headers, ["date"]) || 1;
  const detailCol = findHeaderColumn_(headers, ["detail", "description"]) || 2;
  const amountCol = findHeaderColumn_(headers, [
    "net",
    "value (net)",
    "value",
    "amount",
    "total"
  ]) || 3;

  return {
    headerRow: headerRow,
    dateCol: dateCol,
    detailCol: detailCol,
    amountCol: amountCol
  };
}

function findRechargeHeaderRow_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastCol = Math.max(sheet.getLastColumn(), 3);
  const scanRows = Math.min(lastRow, 20);
  const values = sheet.getRange(1, 1, scanRows, lastCol).getValues();

  for (let i = 0; i < values.length; i++) {
    const row = values[i].map(function(value) {
      return String(value || "").trim().toLowerCase();
    });

    if (row.indexOf("date") > -1 && row.indexOf("detail") > -1) {
      return i + 1;
    }
  }

  return 2;
}

function findHeaderColumn_(headers, names) {
  for (let i = 0; i < headers.length; i++) {
    if (names.indexOf(headers[i]) > -1) return i + 1;
  }

  return 0;
}

function getNextRechargeWriteRow_(sheet, target) {
  const formulaRow = findRechargeFormulaRow_(sheet, target);
  const endRow = formulaRow ? formulaRow - 1 : Math.max(sheet.getLastRow(), target.headerRow);

  for (let row = target.headerRow + 1; row <= endRow; row++) {
    const values = [
      sheet.getRange(row, target.dateCol).getValue(),
      sheet.getRange(row, target.detailCol).getValue(),
      sheet.getRange(row, target.amountCol).getValue()
    ];

    if (values.every(function(value) { return value === "" || value === null; })) {
      return row;
    }
  }

  if (formulaRow) {
    sheet.insertRowBefore(formulaRow);
    return formulaRow;
  }

  return sheet.getLastRow() + 1;
}

function findRechargeFormulaRow_(sheet, target) {
  const startRow = target.headerRow + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return 0;

  const formulas = sheet
    .getRange(startRow, target.amountCol, lastRow - target.headerRow, 1)
    .getFormulas();

  for (let i = 0; i < formulas.length; i++) {
    const formula = String(formulas[i][0] || "").toLowerCase();
    if (formula.indexOf("sum(") > -1) return startRow + i;
  }

  return 0;
}

function buildRechargeRow_(booking) {
  return {
    date: parseRechargeDate_(booking.eventDate),
    description: buildRechargeDescription_(booking),
    net: Number(booking.netPrice || 0)
  };
}

function parseRechargeDate_(value) {
  const parts = String(value || "").split("-");
  if (parts.length === 3) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  return value ? new Date(value) : "";
}

function buildRechargeDescription_(booking) {
  const room = getRechargeRoom_(booking);
  const bits = [
    booking.serviceType || "Hospitality",
    booking.hostName || booking.clientCompany || "",
    room || booking.floor || "",
    booking.pax ? booking.pax + " guests" : "",
    booking.bookingId || ""
  ].filter(Boolean);

  return bits.join(" - ");
}

function getRechargeRoom_(booking) {
  const clientEvent =
    booking.clientBooking && booking.clientBooking.event
      ? booking.clientBooking.event
      : {};

  return (
    booking.room ||
    booking.roomOrArea ||
    booking.deliveryPoint ||
    clientEvent.roomOrArea ||
    clientEvent.deliveryPoint ||
    ""
  );
}
