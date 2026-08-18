function installNightlyArchiveTrigger() {
  getArchiveFolder_();
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "nightlyArchiveDrinkLog") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("nightlyArchiveDrinkLog")
    .timeBased()
    .everyDays(1)
    .atHour(20)
    .inTimezone(HOT_DRINKS_CONFIG.timezone)
    .create();
  logAudit_("ARCHIVE_TRIGGER_INSTALLED", "", "", "", getUser_(), "Nightly archive trigger installed for 20:00.");
  return { ok: true, message: "Nightly archive trigger installed for 20:00." };
}

function getHotDrinkArchiveFolderId() {
  return getArchiveFolder_().getId();
}

function setHotDrinkArchiveFolderId(folderId) {
  const folder = DriveApp.getFolderById(String(folderId || "").trim());
  PropertiesService.getScriptProperties().setProperty("HOT_DRINK_ARCHIVE_FOLDER_ID", folder.getId());
  return { ok: true, folderId: folder.getId(), folderName: folder.getName() };
}

function verifyHotDrinkLaunchReadiness() {
  setupHotDrinkTally();
  const spreadsheet = getSpreadsheet_();
  const folder = getArchiveFolder_();
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === "nightlyArchiveDrinkLog";
  });
  const sheetRows = getSheetLogRows_();
  const activeSheetRows = sheetRows.filter(function(row) {
    return row.status === "ACTIVE";
  });
  const today = Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
  const archiveFiles = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (/^munich-re-hot-drinks-\d{4}-\d{2}-\d{2}\.json$/.test(file.getName())) {
      archiveFiles.push({ name: file.getName(), updated: file.getLastUpdated().toISOString() });
    }
  }
  archiveFiles.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });
  return {
    ok: triggers.length > 0,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    archiveFolderId: folder.getId(),
    archiveFolderName: folder.getName(),
    nightlyArchiveTriggers: triggers.length,
    triggerHandler: "nightlyArchiveDrinkLog",
    intendedTriggerHour: "20:00 Europe/London",
    today: today,
    activeRowsCurrentlyInSheet: activeSheetRows.length,
    archiveFileCount: archiveFiles.length,
    latestArchiveFile: archiveFiles.length ? archiveFiles[archiveFiles.length - 1] : null,
    message: triggers.length ? "Launch readiness checks passed." : "No nightly archive trigger is installed. Run installNightlyArchiveTrigger()."
  };
}

function ensureHotDrinkLaunchReadiness() {
  const triggerResult = installNightlyArchiveTrigger();
  const readiness = verifyHotDrinkLaunchReadiness();
  readiness.triggerInstallResult = triggerResult;
  return readiness;
}

function nightlyArchiveDrinkLog() {
  return archiveCompletedDrinkLogDays({ includeToday: true });
}

function archiveCompletedDrinkLogDays(options) {
  setupHotDrinkTally();
  const archiveOptions = options || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error("Archive is already running. Try again shortly.");
  }
  try {
  const today = Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
  const latestArchiveDate = archiveOptions.includeToday ? today : archiveOffsetDateKey_(-1);
  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
  const allSheetRows = getSheetLogRows_();
  const liveRows = allSheetRows.filter(function(row) {
    return row.date && row.date <= latestArchiveDate;
  });
  const rowsToKeep = allSheetRows.filter(function(row) {
    return !row.date || row.date > latestArchiveDate;
  });
  if (!liveRows.length) {
    logAudit_("ARCHIVE_NO_ROWS", "", "Combined", "", getUser_(), "No rows up to " + latestArchiveDate + " were available to archive.");
    return { ok: true, archivedDates: [], archivedRows: 0 };
  }
  const byDate = {};
  liveRows.forEach(function(row) {
    if (!byDate[row.date]) byDate[row.date] = [];
    byDate[row.date].push(row);
  });

  const archivedDates = Object.keys(byDate).sort();
  archivedDates.forEach(function(date) {
    writeArchiveForDate_(date, byDate[date]);
  });

  rewriteDrinkLogRows_(sheet, rowsToKeep);

  const archivedRows = liveRows.length;
  logAudit_("ARCHIVE_COMPLETED_DAYS", "", "Combined", "", getUser_(), archivedRows + " rows archived across " + archivedDates.length + " day(s).");
  return { ok: true, archivedDates: archivedDates, archivedRows: archivedRows };
  } finally {
    lock.releaseLock();
  }
}

function rewriteDrinkLogRows_(sheet, rowsToKeep) {
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), DRINK_LOG_HEADERS.length);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  }

  if (rowsToKeep.length) {
    sheet.getRange(2, 1, rowsToKeep.length, DRINK_LOG_HEADERS.length)
      .setValues(rowsToKeep.map(logRowToSheetValues_));
  }

  const desiredRows = Math.max(2, rowsToKeep.length + 1);
  const maxRows = sheet.getMaxRows();
  if (maxRows > desiredRows) {
    sheet.deleteRows(desiredRows + 1, maxRows - desiredRows);
  }
}

function logRowToSheetValues_(row) {
  return [
    row.id || "",
    row.timestamp || "",
    row.date || "",
    row.time || "",
    row.floor || "",
    row.drink || "",
    row.device || "",
    row.source || "",
    row.status || "ACTIVE",
    row.clientTapId || ""
  ];
}

function writeArchiveForDate_(date, rows) {
  const folder = getArchiveFolder_();
  const filename = archiveFilename_(date);
  const existing = getArchiveFile_(folder, filename);
  const existingRows = existing ? readArchiveFileRows_(existing) : [];
  const merged = mergeArchiveRows_(existingRows, rows);
  const archive = {
    schemaVersion: 1,
    appName: HOT_DRINKS_CONFIG.appName,
    spreadsheetId: getSpreadsheet_().getId(),
    archivedAt: new Date().toISOString(),
    date: date,
    rowCount: merged.length,
    headers: DRINK_LOG_HEADERS,
    rows: merged.map(function(row) {
      return {
        id: row.id,
        timestamp: dateTimeIso_(row.date, row.time, row.timestamp),
        date: row.date,
        time: row.time,
        floor: row.floor,
        drink: row.drink,
        device: row.device,
        source: row.source,
        status: row.status,
        clientTapId: row.clientTapId || ""
      };
    })
  };
  const tempName = filename + ".tmp-" + Utilities.getUuid();
  const tempFile = folder.createFile(tempName, JSON.stringify(archive, null, 2), MimeType.PLAIN_TEXT);
  verifyArchiveFile_(tempFile, date, merged);
  if (existing) existing.setTrashed(true);
  tempFile.setName(filename);
  verifyArchiveFile_(tempFile, date, merged);
}

function readArchivedLogRows_() {
  const folderId = PropertiesService.getScriptProperties().getProperty("HOT_DRINK_ARCHIVE_FOLDER_ID");
  if (!folderId) return [];
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (error) {
    return [];
  }
  const rows = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/^munich-re-hot-drinks-\d{4}-\d{2}-\d{2}\.json$/.test(file.getName())) continue;
    rows.push.apply(rows, readArchiveFileRows_(file));
  }
  return rows;
}

function readArchiveFileRows_(file) {
  try {
    const archive = JSON.parse(file.getBlob().getDataAsString());
    return (archive.rows || []).map(function(row) {
      return {
        rowNumber: 0,
        headerMap: {},
        id: row.id || "",
        timestamp: row.timestamp || "",
        date: dateKey_(row.date),
        time: timeKey_(row.time),
        floor: String(row.floor || ""),
        drink: String(row.drink || ""),
        device: String(row.device || ""),
        source: String(row.source || ""),
        status: String(row.status || "ACTIVE"),
        clientTapId: String(row.clientTapId || ""),
        archived: true
      };
    });
  } catch (error) {
    logAudit_("ARCHIVE_READ_ERROR", "", "", "", getUser_(), file.getName() + ": " + (error.message || String(error)));
    return [];
  }
}

function getArchiveFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty("HOT_DRINK_ARCHIVE_FOLDER_ID");
  if (existingId) {
    try {
      return DriveApp.getFolderById(existingId);
    } catch (error) {
      properties.deleteProperty("HOT_DRINK_ARCHIVE_FOLDER_ID");
    }
  }
  const folder = DriveApp.createFolder("Munich RE Hot Drink Archives");
  properties.setProperty("HOT_DRINK_ARCHIVE_FOLDER_ID", folder.getId());
  return folder;
}

function getArchiveFile_(folder, filename) {
  const files = folder.getFilesByName(filename);
  return files.hasNext() ? files.next() : null;
}

function archiveFilename_(date) {
  return "munich-re-hot-drinks-" + date + ".json";
}

function mergeArchiveRows_(existingRows, newRows) {
  const seen = {};
  const merged = [];
  existingRows.concat(newRows).forEach(function(row) {
    const key = row.clientTapId || row.id || [row.date, row.time, row.floor, row.drink, row.device].join("|");
    if (seen[key]) return;
    seen[key] = true;
    merged.push(row);
  });
  return merged.sort(function(a, b) {
    return String(a.date + " " + a.time).localeCompare(String(b.date + " " + b.time));
  });
}

function dateTimeIso_(date, time, fallback) {
  if (fallback && Object.prototype.toString.call(fallback) === "[object Date]") return fallback.toISOString();
  if (fallback && typeof fallback === "string" && fallback.indexOf("T") !== -1) return fallback;
  return date + "T" + (time || "00:00:00");
}

function verifyArchiveFile_(file, date, expectedRows) {
  const archive = JSON.parse(file.getBlob().getDataAsString());
  const actualRows = archive.rows || [];
  if (archive.date !== date) {
    throw new Error("Archive verification failed for " + date + ": date mismatch.");
  }
  if (actualRows.length !== expectedRows.length) {
    throw new Error("Archive verification failed for " + date + ": expected " + expectedRows.length + " rows but found " + actualRows.length + ".");
  }
  const expected = {};
  expectedRows.forEach(function(row) {
    expected[archiveRowKey_(row)] = true;
  });
  actualRows.forEach(function(row) {
    const key = archiveRowKey_(row);
    if (!expected[key]) {
      throw new Error("Archive verification failed for " + date + ": unexpected row " + key + ".");
    }
  });
  return true;
}

function archiveRowKey_(row) {
  return row.clientTapId || row.id || [row.date, row.time, row.floor, row.drink, row.device].join("|");
}

function archiveOffsetDateKey_(offsetDays) {
  const now = new Date();
  const output = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  output.setDate(output.getDate() + Number(offsetDays || 0));
  return Utilities.formatDate(output, HOT_DRINKS_CONFIG.timezone, "yyyy-MM-dd");
}
