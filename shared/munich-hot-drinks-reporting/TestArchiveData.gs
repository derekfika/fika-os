const HOT_DRINK_TEST_ARCHIVE_SOURCE = "HOT_DRINK_TEST_ARCHIVE";

function generateJune2026ArchiveTestData() {
  return generateMonthlyArchiveTestData_(2026, 6);
}

function generateMonthlyArchiveTestData_(year, monthNumber) {
  setupHotDrinkTally();
  const settings = getSettings_();
  const folder = getArchiveFolder_();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const generatedDates = [];
  const skippedDates = [];
  let totalRows = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateKeyFromParts_(year, monthNumber, day);
    const rows = shouldGenerateRowsForDate_(date, settings)
      ? buildSyntheticRowsForDate_(date, settings)
      : [];
    writeSyntheticArchiveForDate_(folder, date, rows);
    generatedDates.push(date);
    totalRows += rows.length;
    if (!rows.length) skippedDates.push(date);
  }

  logAudit_(
    "TEST_ARCHIVE_MONTH_GENERATED",
    "",
    "Combined",
    "",
    getUser_(),
    totalRows + " synthetic rows written across " + generatedDates.length + " archive JSON file(s)."
  );
  return {
    ok: true,
    month: year + "-" + pad2_(monthNumber),
    folderId: folder.getId(),
    filesWritten: generatedDates.length,
    rowCount: totalRows,
    emptyFiles: skippedDates.length,
    skippedDates: skippedDates
  };
}

function clearJune2026ArchiveTestData() {
  return clearMonthlyArchiveTestData_(2026, 6);
}

function clearMonthlyArchiveTestData_(year, monthNumber) {
  setupHotDrinkTally();
  const folder = getArchiveFolder_();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  let filesUpdated = 0;
  let rowsRemoved = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateKeyFromParts_(year, monthNumber, day);
    const filename = archiveFilename_(date);
    const existing = getArchiveFile_(folder, filename);
    if (!existing) continue;
    const existingRows = readArchiveFileRows_(existing);
    const keptRows = existingRows.filter(function(row) {
      return row.source !== HOT_DRINK_TEST_ARCHIVE_SOURCE;
    });
    rowsRemoved += existingRows.length - keptRows.length;
    if (keptRows.length) {
      replaceArchiveFileForDate_(folder, existing, date, keptRows);
    } else {
      existing.setTrashed(true);
    }
    filesUpdated += 1;
  }

  logAudit_(
    "TEST_ARCHIVE_MONTH_CLEARED",
    "",
    "Combined",
    "",
    getUser_(),
    rowsRemoved + " synthetic archive rows removed from " + filesUpdated + " file(s)."
  );
  return {
    ok: true,
    month: year + "-" + pad2_(monthNumber),
    filesUpdated: filesUpdated,
    rowsRemoved: rowsRemoved
  };
}

function shouldGenerateRowsForDate_(date, settings) {
  const day = parseLocalDate_(date).getDay();
  if (day === 0 || day === 6) return false;
  if ((settings.bankHolidays || []).indexOf(date) !== -1) return false;
  if ((settings.closedDays || []).indexOf(date) !== -1) return false;
  return true;
}

function buildSyntheticRowsForDate_(date, settings) {
  const seed = numericSeed_(date);
  const rows = [];
  const activeBuckets = HOT_DRINKS_CONFIG.timeBuckets.filter(function(bucket) { return !bucket.closed; });
  const target = syntheticDailyVolume_(date, seed);
  const floors = settings.floors && settings.floors.length ? settings.floors : HOT_DRINKS_CONFIG.floors;
  const drinks = settings.drinks && settings.drinks.length ? settings.drinks : HOT_DRINKS_CONFIG.drinks;

  for (let index = 0; index < target; index += 1) {
    const drink = weightedPick_(drinks, drinkWeights_(drinks), seed + index * 17);
    const floor = weightedPick_(floors, floors.map(function(floorName) {
      return floorName === "3rd Floor" ? 74 : 26;
    }), seed + index * 31);
    const bucket = weightedPick_(activeBuckets, activeBuckets.map(function(bucketItem) {
      return bucketWeight_(bucketItem.label);
    }), seed + index * 47);
    const time = randomTimeInBucket_(bucket, seed + index * 61);
    rows.push({
      id: "TEST-JUNE-2026-" + date + "-" + pad4_(index + 1),
      timestamp: dateTimeIso_(date, time, ""),
      date: date,
      time: time,
      floor: floor,
      drink: drink,
      device: "Synthetic June archive data",
      source: HOT_DRINK_TEST_ARCHIVE_SOURCE,
      status: "ACTIVE",
      clientTapId: "test-june-2026-" + date + "-" + pad4_(index + 1)
    });
  }

  return rows.sort(function(a, b) { return a.time.localeCompare(b.time); });
}

function syntheticDailyVolume_(date, seed) {
  const day = parseLocalDate_(date).getDay();
  const baseByDay = {
    1: 430,
    2: 520,
    3: 560,
    4: 540,
    5: 370
  };
  const swing = Math.round((seededRandom_(seed) - 0.5) * 90);
  return Math.max(260, (baseByDay[day] || 420) + swing);
}

function drinkWeights_(drinks) {
  const weights = {
    Coffee: 42,
    Cappuccino: 16,
    Latte: 15,
    "Flat White": 12,
    Tea: 8,
    "Hot Chocolate": 3,
    Chai: 2,
    "Drink Special": 2
  };
  return drinks.map(function(drink) { return weights[drink] || 1; });
}

function bucketWeight_(label) {
  const weights = {
    "08:00-09:00": 11,
    "09:00-10:00": 21,
    "10:00-11:00": 28,
    "11:00-12:00": 17,
    "14:00-15:00": 12,
    "15:00-16:00": 9,
    "16:00-16:30": 2
  };
  return weights[label] || 1;
}

function randomTimeInBucket_(bucket, seed) {
  const start = minutesFromTime_(bucket.start);
  const end = minutesFromTime_(bucket.end);
  const minute = start + Math.floor(seededRandom_(seed) * Math.max(1, end - start));
  const second = Math.floor(seededRandom_(seed + 997) * 60);
  return pad2_(Math.floor(minute / 60)) + ":" + pad2_(minute % 60) + ":" + pad2_(second);
}

function weightedPick_(items, weights, seed) {
  const total = weights.reduce(function(sum, value) { return sum + Number(value || 0); }, 0);
  let target = seededRandom_(seed) * total;
  for (let i = 0; i < items.length; i += 1) {
    target -= Number(weights[i] || 0);
    if (target <= 0) return items[i];
  }
  return items[items.length - 1];
}

function writeSyntheticArchiveForDate_(folder, date, rows) {
  const filename = archiveFilename_(date);
  const existing = getArchiveFile_(folder, filename);
  const existingRows = existing ? readArchiveFileRows_(existing) : [];
  const keptRows = existingRows.filter(function(row) {
    return row.source !== HOT_DRINK_TEST_ARCHIVE_SOURCE;
  });
  replaceArchiveFileForDate_(folder, existing, date, mergeArchiveRows_(keptRows, rows));
}

function replaceArchiveFileForDate_(folder, existing, date, rows) {
  if (existing) existing.setTrashed(true);
  const archive = {
    schemaVersion: 1,
    appName: HOT_DRINKS_CONFIG.appName,
    spreadsheetId: getSpreadsheet_().getId(),
    archivedAt: new Date().toISOString(),
    date: date,
    rowCount: rows.length,
    headers: DRINK_LOG_HEADERS,
    rows: rows.map(function(row) {
      return {
        id: row.id,
        timestamp: dateTimeIso_(row.date, row.time, row.timestamp),
        date: row.date,
        time: row.time,
        floor: row.floor,
        drink: row.drink,
        device: row.device,
        source: row.source,
        status: row.status || "ACTIVE",
        clientTapId: row.clientTapId || ""
      };
    })
  };
  folder.createFile(archiveFilename_(date), JSON.stringify(archive, null, 2), MimeType.PLAIN_TEXT);
}

function minutesFromTime_(time) {
  const parts = String(time || "00:00").split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function numericSeed_(text) {
  let hash = 0;
  String(text || "").split("").forEach(function(character) {
    hash = ((hash << 5) - hash) + character.charCodeAt(0);
    hash |= 0;
  });
  return Math.abs(hash) || 1;
}

function seededRandom_(seed) {
  const value = Math.sin(Number(seed || 1) * 9301 + 49297) * 233280;
  return value - Math.floor(value);
}

function dateKeyFromParts_(year, monthNumber, day) {
  return year + "-" + pad2_(monthNumber) + "-" + pad2_(day);
}

function pad2_(value) {
  return String(value).padStart(2, "0");
}

function pad4_(value) {
  return String(value).padStart(4, "0");
}
