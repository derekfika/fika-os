function recordDrinkTap(payload) {
  setupHotDrinkTally();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const settings = getSettings_();
    const floor = String(payload && payload.floor || "");
    const drink = String(payload && payload.drink || "");
    const clientTapId = String(payload && payload.clientTapId || "");
    const device = String(payload && payload.device || getUser_() || "Unknown device");

    if (settings.floors.indexOf(floor) === -1) throw new Error("Unknown floor: " + floor);
    if (settings.drinks.indexOf(drink) === -1) throw new Error("Unknown drink: " + drink);
    if (clientTapId && clientTapIdExists_(clientTapId)) {
      return { ok: true, duplicate: true, counts: getTodayCounts(), message: "Duplicate tap ignored." };
    }

    const now = new Date();
    const id = Utilities.getUuid();
    const row = [
      id,
      now,
      Utilities.formatDate(now, HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd"),
      Utilities.formatDate(now, HOT_DRINKS_CONFIG.timezone, "HH:mm:ss"),
      floor,
      drink,
      device,
      HOT_DRINKS_CONFIG.source,
      "ACTIVE",
      clientTapId
    ];
    const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
    sheet.appendRow(row);
    return { ok: true, id: id, counts: getTodayCounts() };
  } catch (error) {
    logAudit_("ERROR", "", payload && payload.floor, payload && payload.drink, getUser_(), error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function recordDrinkTapBatch(payloads) {
  setupHotDrinkTally();
  const taps = Array.isArray(payloads) ? payloads : [];
  if (!taps.length) return { ok: true, saved: 0, counts: getTodayCounts() };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2500)) {
    throw new Error("Sync is busy. The tablet will retry shortly.");
  }
  try {
    const settings = getSettings_();
    const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
    const now = new Date();
    const rows = [];
    const seen = getExistingClientTapIds_(sheet);

    taps.forEach(function(payload) {
      const floor = String(payload && payload.floor || "");
      const drink = String(payload && payload.drink || "");
      const clientTapId = String(payload && payload.clientTapId || "");
      const device = String(payload && payload.device || getUser_() || "Unknown device");
      const tappedAt = payload && payload.tappedAt ? new Date(payload.tappedAt) : now;

      if (settings.floors.indexOf(floor) === -1) throw new Error("Unknown floor: " + floor);
      if (settings.drinks.indexOf(drink) === -1) throw new Error("Unknown drink: " + drink);
      if (clientTapId && seen[clientTapId]) return;
      if (clientTapId) seen[clientTapId] = true;

      rows.push([
        Utilities.getUuid(),
        isNaN(tappedAt.getTime()) ? now : tappedAt,
        Utilities.formatDate(isNaN(tappedAt.getTime()) ? now : tappedAt, HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd"),
        Utilities.formatDate(isNaN(tappedAt.getTime()) ? now : tappedAt, HOT_DRINKS_CONFIG.timezone, "HH:mm:ss"),
        floor,
        drink,
        device,
        HOT_DRINKS_CONFIG.source,
        "ACTIVE",
        clientTapId
      ]);
    });

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DRINK_LOG_HEADERS.length).setValues(rows);
    }
    return { ok: true, saved: rows.length, counts: getTodayCounts() };
  } catch (error) {
    logAudit_("ERROR", "", "", "", getUser_(), "Batch sync failed: " + (error.message || String(error)));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function undoLastTap(payload) {
  setupHotDrinkTally();
  const floor = String(payload && payload.floor || "");
  const device = String(payload && payload.device || getUser_() || "Unknown device");
  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
  const values = getSheetLogRows_();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row.status !== "ACTIVE") continue;
    if (floor && row.floor !== floor) continue;
    const rowNumber = row.rowNumber;
    sheet.getRange(rowNumber, row.headerMap.Status).setValue("UNDONE");
    logAudit_("UNDO", row.id, row.floor, row.drink, device, "Marked row " + rowNumber + " as UNDONE.");
    return { ok: true, undone: row, counts: getTodayCounts() };
  }
  return { ok: false, message: "No active tap found to undo.", counts: getTodayCounts() };
}

function getTodayCounts() {
  setupHotDrinkTally();
  const settings = getSettings_();
  const today = Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
  const counts = makeEmptyCounts_(settings);
  getLogRows_().forEach(function(row) {
    if (row.status !== "ACTIVE" || row.date !== today) return;
    counts.total += 1;
    if (!counts.byDrink[row.drink]) counts.byDrink[row.drink] = 0;
    if (!counts.byFloor[row.floor]) counts.byFloor[row.floor] = 0;
    if (!counts.byFloorDrink[row.floor]) counts.byFloorDrink[row.floor] = {};
    if (!counts.byFloorDrink[row.floor][row.drink]) counts.byFloorDrink[row.floor][row.drink] = 0;
    counts.byDrink[row.drink] += 1;
    counts.byFloor[row.floor] += 1;
    counts.byFloorDrink[row.floor][row.drink] += 1;
  });
  counts.date = today;
  return counts;
}

function clientTapIdExists_(clientTapId) {
  if (!clientTapId) return false;
  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
  if (sheet.getLastRow() < 2) return false;
  const map = getHeaderMap_(sheet);
  const values = sheet.getRange(2, map["Client Tap ID"], sheet.getLastRow() - 1, 1).getDisplayValues();
  return values.some(function(row) { return row[0] === clientTapId; });
}

function getExistingClientTapIds_(sheet) {
  const seen = {};
  if (sheet.getLastRow() < 2) return seen;
  const map = getHeaderMap_(sheet);
  const values = sheet.getRange(2, map["Client Tap ID"], sheet.getLastRow() - 1, 1).getDisplayValues();
  values.forEach(function(row) {
    if (row[0]) seen[row[0]] = true;
  });
  return seen;
}

function getLogRows_() {
  return getSheetLogRows_().concat(readArchivedLogRows_());
}

function getSheetLogRows_() {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.drinkLog, DRINK_LOG_HEADERS);
  const map = getHeaderMap_(sheet);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values.map(function(row, index) {
    return {
      rowNumber: index + 2,
      headerMap: map,
      id: row[map.ID - 1],
      timestamp: row[map.Timestamp - 1],
      date: dateKey_(row[map.Date - 1]),
      time: timeKey_(row[map.Time - 1]),
      floor: String(row[map.Floor - 1] || ""),
      drink: String(row[map.Drink - 1] || ""),
      device: String(row[map["Device/User"] - 1] || ""),
      source: String(row[map.Source - 1] || ""),
      status: String(row[map.Status - 1] || "ACTIVE"),
      clientTapId: String(row[map["Client Tap ID"] - 1] || ""),
      archived: false
    };
  });
}

function makeEmptyCounts_(settings) {
  const byDrink = {};
  const byFloor = {};
  const byFloorDrink = {};
  settings.drinks.forEach(function(drink) { byDrink[drink] = 0; });
  settings.floors.forEach(function(floor) {
    byFloor[floor] = 0;
    byFloorDrink[floor] = {};
    settings.drinks.forEach(function(drink) { byFloorDrink[floor][drink] = 0; });
  });
  return { total: 0, byDrink: byDrink, byFloor: byFloor, byFloorDrink: byFloorDrink };
}

function logAudit_(action, submissionId, floor, drink, device, details) {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.auditLog, AUDIT_LOG_HEADERS);
  sheet.appendRow([new Date(), action, submissionId || "", floor || "", drink || "", device || getUser_(), details || ""]);
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach(function(header, index) { map[String(header).trim()] = index + 1; });
  return map;
}

function getUser_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || "";
  } catch (error) {
    return "";
  }
}

function seedMunichReCoffeeTestDay(dateString) {
  setupHotDrinkTally();
  const targetDate = dateKey_(dateString || new Date());
  const rows = []
    .concat(buildCoffeeTestRows_(targetDate, "3rd Floor", 500))
    .concat(buildCoffeeTestRows_(targetDate, "5th Floor", 150))
    .sort(function(a, b) { return a[1].getTime() - b[1].getTime(); });

  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, DRINK_LOG_HEADERS.length).setValues(rows);
  }
  logAudit_("TEST_DATA_SEEDED", "", "Combined", "Coffee", getUser_(), rows.length + " coffee test rows for " + targetDate + ".");
  return {
    ok: true,
    date: targetDate,
    rowsAdded: rows.length,
    byFloor: {
      "3rd Floor": 500,
      "5th Floor": 150
    }
  };
}

function buildCoffeeTestRows_(dateString, floor, count) {
  const output = [];
  for (let i = 0; i < count; i += 1) {
    const timestamp = randomServiceTimestamp_(dateString);
    output.push([
      Utilities.getUuid(),
      timestamp,
      dateString,
      Utilities.formatDate(timestamp, HOT_DRINKS_CONFIG.timezone, "HH:mm:ss"),
      floor,
      "Coffee",
      "TEST Seed",
      "TEST_MUNICH_RE_COFFEE_DAY",
      "ACTIVE",
      "TEST-" + floor.replace(/\W+/g, "-").toUpperCase() + "-" + dateString + "-" + i
    ]);
  }
  return output;
}

function randomServiceTimestamp_(dateString) {
  const windows = [
    { start: "08:00", end: "09:00", weight: 18 },
    { start: "09:00", end: "10:00", weight: 28 },
    { start: "10:00", end: "11:00", weight: 18 },
    { start: "11:00", end: "12:00", weight: 10 },
    { start: "14:00", end: "15:00", weight: 16 },
    { start: "15:00", end: "16:00", weight: 8 },
    { start: "16:00", end: "16:30", weight: 2 }
  ];
  const totalWeight = windows.reduce(function(sum, window) { return sum + window.weight; }, 0);
  let pick = Math.random() * totalWeight;
  const selected = windows.find(function(window) {
    pick -= window.weight;
    return pick <= 0;
  }) || windows[0];
  const start = minutesFromMidnight_(selected.start);
  const end = minutesFromMidnight_(selected.end);
  const minute = start + Math.floor(Math.random() * (end - start));
  const second = Math.floor(Math.random() * 60);
  const parts = dateString.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], Math.floor(minute / 60), minute % 60, second);
}

function minutesFromMidnight_(time) {
  const parts = String(time).split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function dateKey_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + "-" + match[2] + "-" + match[3];
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? text : Utilities.formatDate(parsed, HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
}

function timeKey_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, HOT_DRINKS_CONFIG.timezone, "HH:mm:ss");
  }
  return String(value).trim();
}
