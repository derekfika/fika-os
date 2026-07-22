function getDashboardReport(filters) {
  setupHotDrinkTally();
  const settings = getSettings_();
  const normalized = normalizeFilters_(filters || {});
  const rows = getLogRows_().filter(function(row) {
    return row.status === "ACTIVE" && row.date >= normalized.startDate && row.date <= normalized.endDate;
  }).filter(function(row) {
    if (normalized.floor !== "Combined" && row.floor !== normalized.floor) return false;
    if (normalized.drink !== "All" && row.drink !== normalized.drink) return false;
    if (normalized.excludeBankHolidays && settings.bankHolidays.indexOf(row.date) !== -1) return false;
    if (normalized.excludeClosedPeriods && settings.closedDays.indexOf(row.date) !== -1) return false;
    const weekday = weekdayName_(row.date);
    if (normalized.weekdays.length && normalized.weekdays.indexOf(weekday) === -1) return false;
    return true;
  });

  const summary = summarizeRows_(rows, normalized, settings);
  cacheDashboardReport_(normalized, summary);
  return { ok: true, filters: normalized, settings: settings, summary: summary };
}

function refreshDashboardData() {
  return getDashboardReport({ preset: "today" });
}

function exportFilteredCsv(filters) {
  const report = getDashboardReport(filters);
  const normalized = report.filters;
  const settings = report.settings;
  const rows = getLogRows_().filter(function(row) {
    return row.status === "ACTIVE" && row.date >= normalized.startDate && row.date <= normalized.endDate;
  }).filter(function(row) {
    if (normalized.floor !== "Combined" && row.floor !== normalized.floor) return false;
    if (normalized.drink !== "All" && row.drink !== normalized.drink) return false;
    if (normalized.excludeBankHolidays && settings.bankHolidays.indexOf(row.date) !== -1) return false;
    if (normalized.excludeClosedPeriods && settings.closedDays.indexOf(row.date) !== -1) return false;
    if (normalized.weekdays.length && normalized.weekdays.indexOf(weekdayName_(row.date)) === -1) return false;
    return true;
  });
  const header = ["ID", "Date", "Time", "Floor", "Drink", "Device/User", "Status"];
  const csvRows = [header].concat(rows.map(function(row) {
    return [row.id, row.date, row.time, row.floor, row.drink, row.device, row.status];
  }));
  return {
    ok: true,
    filename: "munich-re-hot-drinks-" + normalized.startDate + "-to-" + normalized.endDate + ".csv",
    csv: csvRows.map(function(row) { return row.map(csvCell_).join(","); }).join("\n")
  };
}

function clearTestData(confirmText) {
  if (String(confirmText || "") !== "CLEAR TEST DATA") throw new Error("Type CLEAR TEST DATA to confirm.");
  const sheet = getSpreadsheet_().getSheetByName(HOT_DRINKS_CONFIG.sheets.drinkLog);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, cleared: 0 };
  const map = getHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  let cleared = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const source = String(values[i][map.Source - 1] || "");
    const device = String(values[i][map["Device/User"] - 1] || "");
    if (source.indexOf("TEST") !== -1 || device.indexOf("TEST") !== -1) {
      sheet.deleteRow(i + 2);
      cleared += 1;
    }
  }
  logAudit_("CLEAR_TEST_DATA", "", "", "", getUser_(), cleared + " test rows deleted.");
  return { ok: true, cleared: cleared };
}

function normalizeFilters_(filters) {
  const today = new Date();
  const preset = String(filters.preset || "today");
  let start = filters.startDate ? parseLocalDate_(filters.startDate) : today;
  let end = filters.endDate ? parseLocalDate_(filters.endDate) : today;
  const day = today.getDay();
  if (preset === "yesterday") start = end = addDays_(today, -1);
  if (preset === "thisWeek") {
    start = addDays_(today, day === 0 ? -6 : 1 - day);
    end = today;
  }
  if (preset === "lastWeek") {
    const thisMonday = addDays_(today, day === 0 ? -6 : 1 - day);
    start = addDays_(thisMonday, -7);
    end = addDays_(thisMonday, -1);
  }
  if (preset === "thisMonth") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = today;
  }
  if (preset === "lastMonth") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  }
  let weekdays = (filters.weekdays || []).filter(Boolean);
  if (preset === "tueThu") weekdays = ["Tuesday", "Wednesday", "Thursday"];
  if (preset === "monThu") weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday"];
  if (preset === "excludeFridays") weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Saturday", "Sunday"];
  return {
    preset: preset,
    startDate: dateKey_(start),
    endDate: dateKey_(end),
    floor: filters.floor || "Combined",
    drink: filters.drink || "All",
    weekdays: weekdays,
    excludeBankHolidays: filters.excludeBankHolidays !== false,
    excludeClosedPeriods: filters.excludeClosedPeriods !== false
  };
}

function summarizeRows_(rows, filters, settings) {
  const byDrink = {};
  const byFloor = {};
  const byWeekday = {};
  const byDate = {};
  const byHour = {};
  const heatmap = {};
  settings.drinks.forEach(function(drink) { byDrink[drink] = 0; });
  settings.floors.forEach(function(floor) { byFloor[floor] = 0; });
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].forEach(function(day) {
    byWeekday[day] = 0;
    heatmap[day] = {};
    HOT_DRINKS_CONFIG.timeBuckets.forEach(function(bucket) { heatmap[day][bucket.label] = 0; });
  });

  rows.forEach(function(row) {
    byDrink[row.drink] = (byDrink[row.drink] || 0) + 1;
    byFloor[row.floor] = (byFloor[row.floor] || 0) + 1;
    byDate[row.date] = (byDate[row.date] || 0) + 1;
    const weekday = weekdayName_(row.date);
    byWeekday[weekday] = (byWeekday[weekday] || 0) + 1;
    const hour = row.time.slice(0, 2) + ":00";
    byHour[hour] = (byHour[hour] || 0) + 1;
    const bucket = bucketForTime_(row.time);
    if (bucket && (!filters.excludeClosedPeriods || !bucket.closed)) heatmap[weekday][bucket.label] += 1;
  });

  const activeDates = Object.keys(byDate);
  const drinkMix = {};
  Object.keys(byDrink).forEach(function(drink) {
    drinkMix[drink] = rows.length ? Math.round((byDrink[drink] / rows.length) * 1000) / 10 : 0;
  });

  return {
    total: rows.length,
    byDrink: byDrink,
    byFloor: byFloor,
    byWeekday: byWeekday,
    byDate: byDate,
    byHour: byHour,
    averagePerDay: activeDates.length ? round_(rows.length / activeDates.length) : 0,
    averageByWeekday: averageByWeekday_(byDate),
    tuesdayThursdayDailyAverage: averageForWeekdays_(byDate, ["Tuesday", "Wednesday", "Thursday"]),
    mondayThursdayDailyAverage: averageForWeekdays_(byDate, ["Monday", "Tuesday", "Wednesday", "Thursday"]),
    averageByFloor: averageMap_(byFloor, activeDates.length),
    averageByDrink: averageMap_(byDrink, activeDates.length),
    peakHour: maxKey_(byHour),
    quietestHour: minKey_(byHour),
    busiestDay: maxKey_(byDate),
    heatmap: heatmap,
    drinkMix: drinkMix,
    trend: activeDates.sort().map(function(date) { return { date: date, total: byDate[date] }; })
  };
}

function cacheDashboardReport_(filters, summary) {
  const sheet = getOrCreateSheet_(getSpreadsheet_(), HOT_DRINKS_CONFIG.sheets.dashboardData, DASHBOARD_DATA_HEADERS);
  sheet.appendRow([new Date(), filters.startDate, filters.endDate, JSON.stringify(filters), JSON.stringify(summary)]);
}

function averageByWeekday_(byDate) {
  const totals = {};
  const counts = {};
  Object.keys(byDate).forEach(function(date) {
    const weekday = weekdayName_(date);
    totals[weekday] = (totals[weekday] || 0) + byDate[date];
    counts[weekday] = (counts[weekday] || 0) + 1;
  });
  Object.keys(totals).forEach(function(day) { totals[day] = round_(totals[day] / counts[day]); });
  return totals;
}

function averageForWeekdays_(byDate, weekdays) {
  const dates = Object.keys(byDate).filter(function(date) { return weekdays.indexOf(weekdayName_(date)) !== -1; });
  const total = dates.reduce(function(sum, date) { return sum + byDate[date]; }, 0);
  return dates.length ? round_(total / dates.length) : 0;
}

function averageMap_(map, divisor) {
  const output = {};
  Object.keys(map).forEach(function(key) { output[key] = divisor ? round_(map[key] / divisor) : 0; });
  return output;
}

function bucketForTime_(time) {
  return HOT_DRINKS_CONFIG.timeBuckets.find(function(bucket) {
    return time >= bucket.start + ":00" && time < bucket.end + ":00";
  }) || null;
}

function weekdayName_(dateString) {
  const date = parseLocalDate_(dateString);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()];
}

function parseLocalDate_(dateString) {
  const parts = String(dateString || dateKey_(new Date())).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays_(date, days) {
  const output = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  output.setDate(output.getDate() + days);
  return output;
}

function maxKey_(map) {
  const keys = Object.keys(map);
  if (!keys.length) return "";
  return keys.reduce(function(best, key) { return map[key] > map[best] ? key : best; }, keys[0]);
}

function minKey_(map) {
  const keys = Object.keys(map).filter(function(key) { return map[key] > 0; });
  if (!keys.length) return "";
  return keys.reduce(function(best, key) { return map[key] < map[best] ? key : best; }, keys[0]);
}

function round_(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function csvCell_(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
