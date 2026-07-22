const HOT_DRINKS_REPORTING_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function getDashboardReport(filters) {
  setupHotDrinkTally();
  const settings = getSettings_();
  const normalized = normalizeFilters_(filters || {});
  const rows = getLogRowsForDateRange_(normalized.startDate, normalized.endDate).filter(function(row) {
    return row.status === "ACTIVE" && row.date >= normalized.startDate && row.date <= normalized.endDate;
  }).filter(function(row) {
    if (!isReportingWeekday_(row.date)) return false;
    if (normalized.floor !== "Combined" && row.floor !== normalized.floor) return false;
    if (normalized.drink !== "All" && row.drink !== normalized.drink) return false;
    if (normalized.excludeBankHolidays && settings.bankHolidays.indexOf(row.date) !== -1) return false;
    if (normalized.excludeClosedPeriods && settings.closedDays.indexOf(row.date) !== -1) return false;
    const weekday = weekdayName_(row.date);
    if (normalized.weekdays.length && normalized.weekdays.indexOf(weekday) === -1) return false;
    return true;
  });

  const summary = summarizeRows_(rows, normalized, settings);
  maybeCacheDashboardReport_(normalized, summary);
  return { ok: true, filters: normalized, settings: settings, summary: summary };
}

function refreshDashboardData() {
  return getDashboardReport({ preset: "today" });
}

function exportFilteredCsv(filters) {
  const report = getDashboardReport(filters);
  const normalized = report.filters;
  const settings = report.settings;
  const rows = getLogRowsForDateRange_(normalized.startDate, normalized.endDate).filter(function(row) {
    return row.status === "ACTIVE" && row.date >= normalized.startDate && row.date <= normalized.endDate;
  }).filter(function(row) {
    if (!isReportingWeekday_(row.date)) return false;
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

function exportPdfReport(filters) {
  const report = getDashboardReport(filters);
  const normalized = report.filters;
  const summary = report.summary;
  const template = HtmlService.createTemplateFromFile("PdfReport");
  template.report = buildPdfReportModel_(normalized, summary, report.settings);
  const filename = "Munich-Re-hot-drink-report-" + normalized.startDate + "-to-" + normalized.endDate + ".pdf";
  const blob = template.evaluate().getBlob().getAs(MimeType.PDF).setName(filename);
  return {
    ok: true,
    filename: filename,
    base64: Utilities.base64Encode(blob.getBytes())
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
  if (preset === "excludeFridays") weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday"];
  weekdays = weekdays.filter(function(dayName) {
    return HOT_DRINKS_REPORTING_WEEKDAYS.indexOf(dayName) !== -1;
  });
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
  const heatmapDrinkTop = {};
  const hourlyDrinkMix = {};
  let excludedClosedPeriodRows = 0;
  settings.drinks.forEach(function(drink) { byDrink[drink] = 0; });
  settings.floors.forEach(function(floor) { byFloor[floor] = 0; });
  HOT_DRINKS_CONFIG.timeBuckets.forEach(function(bucket) {
    hourlyDrinkMix[bucket.label] = makeDrinkCountMap_(settings.drinks);
  });
  HOT_DRINKS_REPORTING_WEEKDAYS.forEach(function(day) {
    byWeekday[day] = 0;
    heatmap[day] = {};
    heatmapDrinkTop[day] = {};
    HOT_DRINKS_CONFIG.timeBuckets.forEach(function(bucket) { heatmap[day][bucket.label] = 0; });
  });

  rows.forEach(function(row) {
    byDrink[row.drink] = (byDrink[row.drink] || 0) + 1;
    byFloor[row.floor] = (byFloor[row.floor] || 0) + 1;
    byDate[row.date] = (byDate[row.date] || 0) + 1;
    const weekday = weekdayName_(row.date);
    if (HOT_DRINKS_REPORTING_WEEKDAYS.indexOf(weekday) === -1) return;
    byWeekday[weekday] = (byWeekday[weekday] || 0) + 1;
    const hour = row.time.slice(0, 2) + ":00";
    byHour[hour] = (byHour[hour] || 0) + 1;
    const bucket = bucketForTime_(row.time);
    if (bucket && (!filters.excludeClosedPeriods || !bucket.closed)) {
      heatmap[weekday][bucket.label] += 1;
      hourlyDrinkMix[bucket.label][row.drink] = (hourlyDrinkMix[bucket.label][row.drink] || 0) + 1;
      heatmapDrinkTop[weekday][bucket.label] = topDrinkForBucket_(heatmapDrinkTop[weekday][bucket.label], row.drink);
    } else if (bucket && filters.excludeClosedPeriods && bucket.closed) {
      excludedClosedPeriodRows += 1;
    }
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
    heatmapDrinkTop: finalizeHeatmapDrinkTop_(heatmapDrinkTop, heatmap),
    hourlyDrinkMix: buildHourlyDrinkMix_(hourlyDrinkMix),
    excludedClosedPeriodRows: excludedClosedPeriodRows,
    drinkMix: drinkMix,
    trend: activeDates.sort().map(function(date) { return { date: date, total: byDate[date] }; })
  };
}

function makeDrinkCountMap_(drinks) {
  const output = {};
  (drinks || []).forEach(function(drink) { output[drink] = 0; });
  return output;
}

function topDrinkForBucket_(current, drink) {
  const counts = current && current.counts ? current.counts : {};
  counts[drink] = (counts[drink] || 0) + 1;
  const top = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  })[0];
  return { drink: top, count: counts[top], counts: counts };
}

function finalizeHeatmapDrinkTop_(heatmapDrinkTop, heatmap) {
  const output = {};
  Object.keys(heatmap || {}).forEach(function(day) {
    output[day] = {};
    Object.keys(heatmap[day] || {}).forEach(function(bucket) {
      const top = heatmapDrinkTop[day] && heatmapDrinkTop[day][bucket];
      output[day][bucket] = top ? { drink: top.drink, count: top.count, total: heatmap[day][bucket] || 0 } : { drink: "", count: 0, total: 0 };
    });
  });
  return output;
}

function buildHourlyDrinkMix_(hourlyDrinkMix) {
  return Object.keys(hourlyDrinkMix).map(function(bucket) {
    const drinks = hourlyDrinkMix[bucket] || {};
    const total = Object.keys(drinks).reduce(function(sum, drink) { return sum + Number(drinks[drink] || 0); }, 0);
    return { bucket: bucket, total: total, drinks: drinks };
  });
}

function maybeCacheDashboardReport_(filters, summary) {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("HOT_DRINK_CACHE_DASHBOARD_RUNS") !== "true") return;
  cacheDashboardReport_(filters, summary);
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

function isReportingWeekday_(dateString) {
  return HOT_DRINKS_REPORTING_WEEKDAYS.indexOf(weekdayName_(dateString)) !== -1;
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

function buildPdfReportModel_(filters, summary, settings) {
  const generatedAt = Utilities.formatDate(new Date(), HOT_DRINKS_CONFIG.timezone, "d MMMM yyyy HH:mm");
  const drinks = (settings && settings.drinks && settings.drinks.length) ? settings.drinks : HOT_DRINKS_CONFIG.drinks;
  const reportWeekdays = HOT_DRINKS_REPORTING_WEEKDAYS;
  const activeDays = Object.keys(summary.byDate || {}).length;
  const drinkRows = mapRows_(summary.byDrink || {}, summary.total, summary.drinkMix || {});
  const floorRows = mapRows_(summary.byFloor || {}, summary.total, null);
  const weekdayRows = mapRowsInOrder_(summary.byWeekday || {}, summary.total, null, reportWeekdays);
  const trend = summary.trend || [];
  const trendMax = Math.max(1, Math.max.apply(null, trend.map(function(item) { return item.total; }).concat([0])));
  const heatmap = summary.heatmap || {};
  const heatmapDays = reportWeekdays.filter(function(day) { return !!heatmap[day]; });
  const displayHeatmap = {};
  heatmapDays.forEach(function(day) { displayHeatmap[day] = heatmap[day]; });
  const heatmapMax = maxNestedValue_(displayHeatmap);
  const drinkColors = ["#00538A", "#0b70a8", "#167a62", "#ff8000", "#4F34C7", "#8f3d2f", "#d39a22", "#647280"];
  const mostPopularDrink = drinkRows.length ? drinkRows.slice().sort(function(a, b) { return b.value - a.value; })[0] : null;
  const floorSplit = floorRows.map(function(row) { return row.label + " " + row.percent + "%"; }).join(" / ") || "-";
  const hourlyDrinkRows = buildPdfHourlyDrinkRows_(summary.hourlyDrinkMix || [], drinks, drinkColors);

  return {
    title: "Hot Drink Usage Report",
    strapline: "Not if, but how",
    period: formatDisplayDate_(filters.startDate) + " - " + formatDisplayDate_(filters.endDate),
    generatedAt: generatedAt,
    generatedLabel: "Prepared " + generatedAt,
    captureStatement: "Live service data captured at point of preparation",
    filters: {
      floor: filters.floor,
      drink: filters.drink,
      preset: filters.preset,
      bankHolidays: filters.excludeBankHolidays ? "Excluded" : "Included",
      closedPeriods: filters.excludeClosedPeriods ? "Excluded" : "Included"
    },
    kpis: [
      { label: "Total drinks", value: summary.total || 0, helper: "Selected report range", tone: "blue" },
      { label: "Average per active day", value: summary.averagePerDay || 0, helper: activeDays + " active day" + (activeDays === 1 ? "" : "s"), tone: "green" },
      { label: "Peak hour", value: summary.peakHour || "-", helper: "Busiest recorded hour", tone: "orange" },
      { label: "Busiest day", value: formatDisplayDate_(summary.busiestDay) || "-", helper: "Highest daily volume", tone: "blue" },
      { label: "Tue-Thu average", value: summary.tuesdayThursdayDailyAverage || 0, helper: "Midweek benchmark", tone: "green" },
      { label: "Mon-Thu average", value: summary.mondayThursdayDailyAverage || 0, helper: "Core week benchmark", tone: "green" },
      { label: "Most popular drink", value: mostPopularDrink && mostPopularDrink.value ? mostPopularDrink.label : "-", helper: mostPopularDrink && mostPopularDrink.value ? mostPopularDrink.percent + "% of drinks" : "No drink activity", tone: "purple" },
      { label: "Floor split", value: floorSplit, helper: "Share of selected volume", tone: "orange" }
    ],
    insightText: buildInsightText_(summary, drinkRows, activeDays),
    hasData: Number(summary.total || 0) > 0,
    activeDays: activeDays,
    quietestHour: summary.quietestHour || "-",
    drinkRows: drinkRows,
    floorRows: floorRows,
    weekdayRows: weekdayRows,
    trendRows: trend.map(function(item) {
      return {
        date: formatShortDate_(item.date),
        total: item.total,
        height: Math.max(4, Math.round(item.total / trendMax * 100))
      };
    }),
    heatmapDays: heatmapDays,
    heatmapBuckets: HOT_DRINKS_CONFIG.timeBuckets.map(function(bucket) { return bucket.label; }),
    heatmapBucketMeta: HOT_DRINKS_CONFIG.timeBuckets,
    heatmap: displayHeatmap,
    heatmapMax: heatmapMax,
    hourlyDrinkRows: hourlyDrinkRows,
    drinks: drinks,
    drinkColors: drinkColors,
    logos: getReportLogos_()
  };
}

function buildInsightText_(summary, drinkRows, activeDays) {
  const total = Number(summary.total || 0);
  if (!total || activeDays < 1) {
    return "No drink activity matched the selected filters, so trend insight is not available for this range.";
  }
  const topDrink = drinkRows.length ? drinkRows.slice().sort(function(a, b) { return b.value - a.value; })[0] : null;
  const parts = ["Across the selected period, the bars recorded " + total + " hot drink" + (total === 1 ? "" : "s") + "."];
  if (topDrink && topDrink.value) {
    parts.push(topDrink.label + " accounted for " + topDrink.percent + "% of activity.");
  }
  if (summary.peakHour) {
    parts.push("Peak demand was recorded around " + summary.peakHour + ".");
  }
  if (summary.tuesdayThursdayDailyAverage) {
    parts.push("Tuesday to Thursday averaged " + summary.tuesdayThursdayDailyAverage + " drinks per active day.");
  }
  return parts.join(" ");
}

function buildPdfHourlyDrinkRows_(rows, drinks, colors) {
  const max = Math.max(1, Math.max.apply(null, (rows || []).map(function(row) { return Number(row.total || 0); }).concat([0])));
  return (rows || []).map(function(row) {
    const segments = (drinks || []).map(function(drink, index) {
      const value = Number((row.drinks || {})[drink] || 0);
      return {
        drink: drink,
        value: value,
        color: colors[index % colors.length],
        width: value ? Math.max(3, Math.round(value / Math.max(1, row.total) * 100)) : 0
      };
    });
    return {
      bucket: row.bucket,
      total: Number(row.total || 0),
      height: Math.max(4, Math.round(Number(row.total || 0) / max * 100)),
      segments: segments
    };
  });
}

function mapRows_(map, total, percentages) {
  const max = Math.max(1, Math.max.apply(null, Object.keys(map).map(function(key) { return Number(map[key] || 0); }).concat([0])));
  return Object.keys(map).map(function(key) {
    const value = Number(map[key] || 0);
    const percent = percentages && percentages[key] != null
      ? percentages[key]
      : total ? Math.round(value / total * 1000) / 10 : 0;
    return {
      label: key,
      value: value,
      percent: percent,
      width: Math.max(2, Math.round(value / max * 100))
    };
  });
}

function mapRowsInOrder_(map, total, percentages, keys) {
  const availableKeys = (keys || []).filter(function(key) { return map[key] != null; });
  const max = Math.max(1, Math.max.apply(null, availableKeys.map(function(key) { return Number(map[key] || 0); }).concat([0])));
  return availableKeys.map(function(key) {
    const value = Number(map[key] || 0);
    const percent = percentages && percentages[key] != null
      ? percentages[key]
      : total ? Math.round(value / total * 1000) / 10 : 0;
    return {
      label: key,
      value: value,
      percent: percent,
      width: Math.max(2, Math.round(value / max * 100))
    };
  });
}

function maxNestedValue_(map) {
  let max = 1;
  Object.keys(map).forEach(function(day) {
    Object.keys(map[day] || {}).forEach(function(bucket) {
      max = Math.max(max, Number(map[day][bucket] || 0));
    });
  });
  return max;
}

function heatOpacity_(value, max) {
  const number = Number(value || 0);
  if (!number) return 0.04;
  return Math.max(0.12, Math.min(0.9, number / Math.max(1, max)));
}

function formatDisplayDate_(dateString) {
  if (!dateString) return "";
  const date = parseLocalDate_(dateString);
  return Utilities.formatDate(date, HOT_DRINKS_CONFIG.timezone, "d MMM yyyy");
}

function formatShortDate_(dateString) {
  if (!dateString) return "";
  const date = parseLocalDate_(dateString);
  return Utilities.formatDate(date, HOT_DRINKS_CONFIG.timezone, "d MMM");
}

function getReportLogos_() {
  return {
    munichRe: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 120" role="img" aria-label="Munich Re logo"><g fill="#00538A"><path d="M28 18h70l28 42-28 42H28L0 60 28 18Zm8 12L16 60l20 30h56l20-30-20-30H36Z"/><path d="M21 48h86v8H21zM21 64h86v8H21z"/><text x="155" y="78" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" letter-spacing="-2">Munich Re</text></g></svg>',
    fika: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1726 740" role="img" aria-label="Fika logo"><path fill="#4F34C7" fill-rule="evenodd" d="M429 0L0 0L0 729L132 729L133 428L395 428L395 296L132 295L132 133L429 132ZM492 194L492 729L624 729L624 194ZM492 0L492 132L624 132L624 0ZM687 0L687 729L820 729L937 573L1054 729L1221 729L1020 462L1221 194L1055 194L820 507L819 0ZM1259 266L1241 286L1222 312L1213 327L1197 361L1187 392L1181 422L1179 441L1179 483L1183 514L1189 539L1203 577L1216 602L1231 625L1247 645L1273 671L1308 697L1346 717L1380 729L1419 737L1441 739L1469 739L1489 737L1518 731L1539 724L1559 715L1584 700L1599 688L1601 692L1603 729L1725 729L1725 194L1603 194L1601 232L1599 236L1587 226L1563 211L1544 202L1518 193L1496 188L1470 185L1440 185L1412 188L1373 197L1346 207L1325 217L1293 237ZM1450 317L1473 318L1500 324L1525 335L1547 350L1568 371L1585 397L1594 419L1600 449L1600 475L1593 508L1581 534L1567 554L1547 574L1530 586L1515 594L1489 603L1458 607L1432 605L1406 598L1383 587L1362 572L1345 555L1329 532L1317 504L1311 473L1312 442L1317 420L1329 392L1345 369L1368 347L1396 330L1422 321Z"/></svg>',
    bloom: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 557 156" role="img" aria-label="Bloom logo"><g fill="none" stroke="#05090B" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v148" /><path d="M30 5h25c16 0 29 15 29 34s-13 35-29 35H30" /><path d="M30 152h37c21 0 37-17 37-38 0-16-9-30-22-35" /><path d="M134 4v148h56" /><path d="M199 66V51c0-27 20-47 47-47s47 20 47 47v15" /><path d="M199 90v15c0 27 20 47 47 47s47-20 47-47V90" /><path d="M322 66V51c0-27 20-47 47-47s47 20 47 47v15" /><path d="M322 90v15c0 27 20 47 47 47s47-20 47-47V90" /><path d="M444 152V4l57 76" /><path d="M553 4v148" /><path d="M553 4l-40 56" /></g></svg>',
    justEat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 884 263" role="img" aria-label="Just Eat for Business logo"><path fill="#ff8000" fill-rule="evenodd" d="M571 215L571 261L579 261L579 215ZM480 215L480 245L483 255L488 260L493 262L505 262L508 261L512 258L513 261L520 261L520 215L512 215L512 246L510 250L507 253L503 255L498 255L495 254L490 249L489 247L489 215ZM737 215L733 217L729 222L728 225L728 231L730 235L735 239L740 241L750 243L754 246L755 250L753 253L749 255L741 255L731 250L726 255L730 259L736 262L752 262L755 261L760 258L763 253L763 244L758 238L750 235L747 235L741 233L737 229L737 225L741 222L750 222L753 223L758 227L763 221L759 217L751 214L741 214ZM697 215L693 217L689 221L688 224L688 232L689 234L693 238L697 240L707 242L711 244L715 249L711 254L708 255L700 255L691 250L686 256L691 260L696 262L712 262L715 261L722 255L723 252L723 245L721 241L719 239L713 236L701 233L697 230L696 227L697 225L701 222L710 222L718 227L723 221L720 218L710 214L701 214ZM649 216L642 222L638 231L638 246L640 251L647 259L654 262L668 262L675 259L680 255L680 253L676 249L674 249L671 252L664 255L658 255L652 252L648 248L647 246L647 241L683 241L683 231L680 224L676 219L669 215L665 214L655 214ZM646 233L648 228L653 223L658 221L662 221L669 224L674 231L673 234ZM590 215L590 261L598 261L598 234L599 229L604 223L611 221L617 223L622 229L623 234L623 261L631 261L631 229L628 221L624 217L617 214L607 214L598 217L598 215ZM538 215L534 217L530 221L529 223L529 232L534 238L538 240L548 242L552 244L555 247L555 251L552 254L549 255L541 255L536 253L532 250L527 256L532 260L537 262L553 262L556 261L562 256L564 251L564 246L562 241L560 239L554 236L548 235L540 232L538 230L537 227L538 225L542 222L551 222L555 224L558 227L564 221L561 218L551 214L542 214ZM403 215L401 215L400 214L392 214L387 216L384 219L383 215L375 215L375 261L384 261L384 231L385 228L392 222L398 223L401 222ZM333 216L325 223L322 228L321 231L321 245L322 248L326 255L335 261L338 262L352 262L361 257L367 248L368 245L368 231L367 228L364 223L356 216L350 214L339 214ZM340 222L349 222L353 224L357 228L360 235L360 242L358 247L352 253L347 255L342 255L337 253L331 247L329 242L329 235L332 228L336 224ZM572 199L570 204L573 208L580 207L581 205L580 200L577 198ZM426 195L426 261L434 261L435 257L439 260L444 262L457 262L462 260L469 254L473 246L474 236L473 235L473 230L469 222L465 218L456 214L445 214L434 218L434 195ZM445 222L454 222L458 224L463 229L465 233L465 243L464 246L459 252L452 255L447 255L442 253L437 248L434 241L434 236L436 230L440 225ZM317 194L311 194L305 196L301 200L299 204L298 215L290 215L290 222L299 223L299 261L307 261L308 222L320 222L320 215L307 214L307 207L308 205L312 202L318 203L320 198L320 195L318 195ZM882 65L808 65L806 66L803 79L804 85L806 86L830 88L818 152L819 162L821 163L836 163L839 161L841 154L851 90L853 86L876 86L880 84L883 70ZM784 65L757 65L752 69L710 156L711 162L717 163L727 163L733 161L737 154L742 141L778 141L780 158L783 162L786 163L797 163L803 161L804 159L804 155L803 154L802 143L789 71L788 68ZM770 88L771 90L771 96L774 111L774 120L752 119L764 94L764 92L766 88ZM654 65L651 68L649 74L636 150L637 161L639 162L700 162L702 160L704 150L703 142L661 141L662 129L664 123L700 123L702 122L704 114L703 104L701 103L667 101L669 88L670 86L714 84L717 71L716 65ZM604 65L530 65L528 67L526 76L526 85L528 86L552 87L550 103L548 109L544 132L541 155L540 156L540 160L541 162L543 162L544 163L558 163L559 162L561 162L563 157L573 93L575 86L599 86L603 83L605 73ZM365 65L362 69L353 122L353 135L355 143L358 149L362 154L367 158L373 161L380 163L401 163L415 158L423 151L427 145L431 135L441 80L441 74L442 73L442 68L441 66L439 65L422 65L420 67L418 74L411 121L408 132L405 137L400 141L397 142L386 142L382 140L377 135L376 132L376 121L384 79L385 67L383 65ZM348 65L307 65L304 69L302 80L303 85L325 86L325 89L315 143L312 149L305 156L300 159L290 162L289 170L293 179L295 181L305 180L316 175L326 167L334 155L339 140L350 77L350 66ZM516 66L513 65L500 64L480 64L474 65L460 71L453 78L449 86L448 91L448 101L450 107L452 110L457 115L466 120L474 123L480 124L490 128L493 131L493 136L490 139L486 141L481 142L465 142L452 140L445 140L442 144L440 157L441 160L443 161L458 163L486 163L498 160L504 157L509 153L512 149L516 140L516 125L514 120L512 117L504 110L494 105L488 103L485 103L475 99L472 96L471 91L475 87L481 85L513 86L516 83L518 76L518 68ZM120 0L106 8L92 18L76 31L52 54L36 72L19 94L0 124L0 134L2 136L27 141L31 146L34 207L37 240L40 257L41 259L44 261L83 261L87 259L85 240L85 223L84 213L75 205L71 197L70 183L70 108L71 102L74 99L76 99L79 102L78 164L80 167L85 168L87 167L89 103L92 99L95 99L98 103L97 164L98 166L105 167L107 165L107 111L108 102L111 99L114 99L116 101L115 132L116 197L112 205L106 210L105 233L107 254L109 260L157 259L160 229L159 216L156 215L143 214L139 210L139 201L141 183L145 160L149 144L157 121L165 105L174 93L178 92L181 95L182 98L183 115L183 165L180 239L178 257L179 260L207 261L209 260L212 256L215 236L219 187L219 171L221 145L222 143L226 140L249 136L253 131L253 127L244 111L234 96L219 77L217 55L213 31L209 26L183 23L181 24L180 26L179 35L162 20L136 2L131 0Z"/></svg>'
  };
}
