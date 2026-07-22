function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Hospitality Dashboard")
      .addItem("Initialise settings", "initialiseDashboardSettings")
      .addItem("Import settings draft", "importDashboardSettingsDraft")
      .addItem("Repair undefined booking IDs", "repairUndefinedBookingIds")
      .addItem("Create hourly inbox scan", "createDashboardScanTrigger")
      .addItem("Remove inbox scan triggers", "deleteDashboardScanTriggers")
      .addToUi();
  } catch (e) {
    Logger.log("Dashboard menu could not be created: " + e);
  }
}

function repairUndefinedBookingIds() {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const lastRow = sh.getLastRow();

  if (lastRow < 2) return { ok: true, repaired: 0 };

  const values = sh
    .getRange(2, 1, lastRow - 1, sh.getLastColumn())
    .getValues();

  const usedIds = {};
  values.forEach(row => {
    const id = String(row[map.BookingID - 1] || "").trim();
    if (id && !/^undefined-/i.test(id)) usedIds[id] = true;
  });

  let repaired = 0;

  values.forEach((row, offset) => {
    const currentId = String(row[map.BookingID - 1] || "").trim();
    if (currentId && !/^undefined-/i.test(currentId)) return;

    const booking = safeJsonParse_(row[map.ParsedJSON - 1], null);
    if (!booking) return;

    const sourceDate = new Date(
      booking.emailReceived ||
      booking.createdAt ||
      Date.now()
    );

    let replacement;
    do {
      replacement = generateBookingId_(sourceDate);
    } while (usedIds[replacement]);

    usedIds[replacement] = true;
    booking.bookingId = replacement;
    booking.updatedAt = new Date();

    row[map.BookingID - 1] = replacement;
    row[map.ParsedJSON - 1] = JSON.stringify(booking);
    values[offset] = row;
    repaired++;
  });

  if (repaired) {
    sh.getRange(2, 1, values.length, sh.getLastColumn()).setValues(values);
  }

  return {
    ok: true,
    repaired,
    siteCode: getBookingSiteCode_()
  };
}

function initialiseDashboardSettings() {
  ensureSettingsDefaults_();
  getDashboardSheet_();

  return {
    ok: true,
    message: "Dashboard settings and data headers initialised."
  };
}

function createDashboardScanTrigger() {
  const fn = "scanInboxForDashboardBookings";

  const exists = ScriptApp
    .getProjectTriggers()
    .some(t => t.getHandlerFunction() === fn);

  if (exists) {
    return { ok: true, message: "Scan trigger already exists." };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyHours(1)
    .create();

  return { ok: true, message: "Hourly scan trigger created." };
}

function deleteDashboardScanTriggers() {
  const fn = "scanInboxForDashboardBookings";

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fn)
    .forEach(t => ScriptApp.deleteTrigger(t));

  return { ok: true, message: "Scan triggers removed." };
}
