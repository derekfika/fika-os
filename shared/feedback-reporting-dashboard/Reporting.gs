function getFeedbackReport(filters) {
  const normalized = normalizeFeedbackFilters_(filters || {});
  const rows = getAllFeedbackRows_().filter(function (row) {
    if (normalized.siteId !== "all" && row.siteId !== normalized.siteId) return false;
    if (normalized.startDate && row.activityDate < normalized.startDate) return false;
    if (normalized.endDate && row.activityDate > normalized.endDate) return false;
    if (normalized.rating !== "all" && String(row.overallSatisfaction) !== normalized.rating) return false;
    if (normalized.status === "followUp" && !row.contactRequested) return false;
    if (normalized.status === "completed" && !row.completed) return false;
    if (normalized.status === "requested" && row.completed) return false;
    return true;
  });
  return {
    ok: true,
    filters: normalized,
    health: getFeedbackReportingHealth(),
    rows: rows.map(sanitizeFeedbackRowForClient_),
    summary: summarizeFeedbackRows_(rows)
  };
}

function exportFeedbackCsv(filters) {
  const report = getFeedbackReport(filters);
  const header = [
    "Site", "Booking Reference", "Submitted Date", "Client", "Event Date",
    "Event Type", "Overall", "Food Quality", "Presentation", "Delivery Timing",
    "Ease Of Booking", "NPS", "Contact Requested", "What Went Well",
    "Improvements", "Additional Comments"
  ];
  const csvRows = [header].concat(report.rows.map(function (row) {
    return [
      row.siteName, row.bookingReference, row.submittedDate, row.clientName,
      row.eventDate, row.eventType, row.overallSatisfaction, row.foodQuality,
      row.presentation, row.deliveryTiming, row.easeOfBooking, row.nps,
      row.contactRequested ? "Yes" : "No", row.whatWentWell,
      row.improvements, row.additionalComments
    ];
  }));
  return {
    ok: true,
    filename: "hospitality-feedback-" + report.filters.startDate + "-to-" + report.filters.endDate + ".csv",
    csv: csvRows.map(function (row) { return row.map(csvCell_).join(","); }).join("\n")
  };
}

function exportFeedbackPdf(filters) {
  const report = getFeedbackReport(filters);
  const template = HtmlService.createTemplateFromFile("PdfReport");
  template.report = buildFeedbackPdfModel_(report);
  const filename = "Hospitality-feedback-report-" + report.filters.startDate + "-to-" + report.filters.endDate + ".pdf";
  const blob = template.evaluate().getBlob().getAs(MimeType.PDF).setName(filename);
  return {
    ok: true,
    filename: filename,
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function normalizeFeedbackFilters_(filters) {
  const today = new Date();
  const preset = String(filters.preset || "thisMonth");
  let start = filters.startDate ? localDate_(filters.startDate) : new Date(today.getFullYear(), today.getMonth(), 1);
  let end = filters.endDate ? localDate_(filters.endDate) : today;
  if (preset === "today") start = end = today;
  if (preset === "last7") start = addDays_(today, -6);
  if (preset === "last30") start = addDays_(today, -29);
  if (preset === "thisMonth") start = new Date(today.getFullYear(), today.getMonth(), 1);
  if (preset === "lastMonth") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  }
  return {
    preset: preset,
    startDate: dateKey_(start),
    endDate: dateKey_(end),
    siteId: String(filters.siteId || "all"),
    rating: String(filters.rating || "all"),
    status: String(filters.status || "all")
  };
}

function getAllFeedbackRows_() {
  const sites = getConfiguredFeedbackSites_().filter(function (site) {
    return site.siteId !== "all" && site.spreadsheetId;
  });
  return sites.reduce(function (output, site) {
    try {
      return output.concat(getFeedbackRowsForSite_(site));
    } catch (error) {
      console.warn("Feedback read failed for " + site.siteName + ": " + error.message);
      return output;
    }
  }, []);
}

function getFeedbackRowsForSite_(site) {
  const spreadsheet = SpreadsheetApp.openById(site.spreadsheetId);
  const responseSheet = spreadsheet.getSheetByName(FEEDBACK_REPORTING_CONFIG.sheets.responses);
  const requestSheet = spreadsheet.getSheetByName(FEEDBACK_REPORTING_CONFIG.sheets.requests);
  if (!responseSheet || responseSheet.getLastRow() < 2) return getRequestRowsForSite_(site, requestSheet, []);

  const responseMap = getHeaderMap_(responseSheet);
  const responseRows = responseSheet.getRange(2, 1, responseSheet.getLastRow() - 1, responseSheet.getLastColumn()).getValues();
  const rows = responseRows.map(function (row) {
    const feedbackJson = parseJson_(row[responseMap["Feedback JSON"] - 1], {});
    const bookingReference = String(row[responseMap["Booking Reference"] - 1] || feedbackJson.bookingReference || "");
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      feedbackId: String(row[responseMap["Feedback ID"] - 1] || ""),
      bookingReference: bookingReference,
      submittedAt: parseDateTimeForClient_(row[responseMap["Submitted At"] - 1]),
      submittedDate: parseDate_(row[responseMap["Submitted At"] - 1]),
      activityDate: parseDate_(row[responseMap["Submitted At"] - 1]),
      overallSatisfaction: Number(row[responseMap["Overall Satisfaction"] - 1] || 0),
      foodQuality: Number(row[responseMap["Food Quality"] - 1] || 0),
      presentation: Number(row[responseMap.Presentation - 1] || 0),
      deliveryTiming: Number(row[responseMap["Delivery Timing"] - 1] || 0),
      easeOfBooking: Number(row[responseMap["Ease Of Booking"] - 1] || 0),
      nps: row[responseMap.NPS - 1] === "" ? "" : Number(row[responseMap.NPS - 1]),
      whatWentWell: String(row[responseMap["What Went Well"] - 1] || ""),
      improvements: String(row[responseMap.Improvements - 1] || ""),
      additionalComments: String(row[responseMap["Additional Comments"] - 1] || ""),
      contactRequested: row[responseMap["Contact Requested"] - 1] === true || String(row[responseMap["Contact Requested"] - 1]).toUpperCase() === "TRUE",
      preferredContactDetails: String(row[responseMap["Preferred Contact Details"] - 1] || ""),
      eventDate: "",
      eventType: "",
      clientName: "",
      completed: true
    };
  });
  return enrichWithRequests_(site, requestSheet, rows);
}

function getRequestRowsForSite_(site, requestSheet, completedRows) {
  return enrichWithRequests_(site, requestSheet, completedRows || []);
}

function enrichWithRequests_(site, requestSheet, completedRows) {
  const byReference = {};
  completedRows.forEach(function (row) { byReference[row.bookingReference] = row; });
  if (!requestSheet || requestSheet.getLastRow() < 2) return completedRows;
  const requestMap = getHeaderMap_(requestSheet);
  const rows = requestSheet.getRange(2, 1, requestSheet.getLastRow() - 1, requestSheet.getLastColumn()).getValues();
  rows.forEach(function (row) {
    const bookingReference = String(row[requestMap["Booking Reference"] - 1] || "");
    if (!bookingReference) return;
    const booking = parseJson_(row[requestMap["Booking Snapshot JSON"] - 1], {});
    const target = byReference[bookingReference] || {
      siteId: site.siteId,
      siteName: site.siteName,
      feedbackId: "",
      bookingReference: bookingReference,
      submittedAt: "",
      submittedDate: "",
      overallSatisfaction: 0,
      foodQuality: 0,
      presentation: 0,
      deliveryTiming: 0,
      easeOfBooking: 0,
      nps: "",
      whatWentWell: "",
      improvements: "",
      additionalComments: "",
      contactRequested: false,
      preferredContactDetails: "",
      completed: false
    };
    target.clientName = String(row[requestMap["Client Name"] - 1] || booking.hostName || "");
    target.clientEmail = String(row[requestMap["Client Email"] - 1] || booking.hostEmail || "");
    target.eventDate = parseDate_(row[requestMap["Event Date"] - 1]) || booking.eventDate || "";
    target.eventType = String(row[requestMap["Event Type"] - 1] || booking.serviceType || "");
    target.requestSentDate = parseDate_(row[requestMap["Request Sent Date"] - 1]);
    target.activityDate = target.submittedDate || target.requestSentDate || target.eventDate || "";
    target.requestSent = row[requestMap["Request Sent"] - 1] === true || String(row[requestMap["Request Sent"] - 1]).toUpperCase() === "TRUE";
    target.opened = row[requestMap.Opened - 1] === true || String(row[requestMap.Opened - 1]).toUpperCase() === "TRUE";
    target.completed = target.completed || row[requestMap.Completed - 1] === true || String(row[requestMap.Completed - 1]).toUpperCase() === "TRUE";
    if (!byReference[bookingReference]) {
      byReference[bookingReference] = target;
      completedRows.push(target);
    }
  });
  return completedRows;
}

function summarizeFeedbackRows_(rows) {
  const completed = rows.filter(function (row) { return row.completed && row.overallSatisfaction; });
  const bySite = {};
  const byRating = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const trend = {};
  let npsPromoters = 0;
  let npsPassives = 0;
  let npsDetractors = 0;
  completed.forEach(function (row) {
    bySite[row.siteName] = bySite[row.siteName] || { total: 0, score: 0, followUps: 0 };
    bySite[row.siteName].total += 1;
    bySite[row.siteName].score += row.overallSatisfaction;
    if (row.contactRequested) bySite[row.siteName].followUps += 1;
    byRating[String(row.overallSatisfaction)] = (byRating[String(row.overallSatisfaction)] || 0) + 1;
    if (row.submittedDate) trend[row.submittedDate] = (trend[row.submittedDate] || 0) + 1;
    if (row.nps !== "") {
      if (row.nps >= 9) npsPromoters++;
      else if (row.nps >= 7) npsPassives++;
      else npsDetractors++;
    }
  });
  Object.keys(bySite).forEach(function (siteName) {
    bySite[siteName].average = round_(bySite[siteName].score / bySite[siteName].total);
  });
  const npsTotal = npsPromoters + npsPassives + npsDetractors;
  return {
    totalRequests: rows.length,
    completed: completed.length,
    completionRate: rows.length ? Math.round(completed.length / rows.length * 100) : 0,
    averageOverall: completed.length ? round_(completed.reduce(function (sum, row) { return sum + row.overallSatisfaction; }, 0) / completed.length) : 0,
    averageFood: averageField_(completed, "foodQuality"),
    averagePresentation: averageField_(completed, "presentation"),
    averageDelivery: averageField_(completed, "deliveryTiming"),
    averageEase: averageField_(completed, "easeOfBooking"),
    followUps: completed.filter(function (row) { return row.contactRequested; }).length,
    nps: npsTotal ? Math.round(((npsPromoters - npsDetractors) / npsTotal) * 100) : "",
    bySite: bySite,
    byRating: byRating,
    trend: Object.keys(trend).sort().map(function (date) { return { date: date, total: trend[date] }; }),
    recentComments: completed.filter(function (row) {
      return row.whatWentWell || row.improvements || row.additionalComments;
    }).sort(function (a, b) {
      return String(b.submittedDate).localeCompare(String(a.submittedDate));
    }).slice(0, 18)
  };
}

function buildFeedbackPdfModel_(report) {
  return {
    generatedAt: Utilities.formatDate(new Date(), FEEDBACK_REPORTING_CONFIG.timeZone, "d MMM yyyy HH:mm"),
    filters: report.filters,
    summary: report.summary,
    rows: report.rows.filter(function (row) { return row.completed; }).slice(0, 60),
    colours: FEEDBACK_REPORTING_CONFIG.colours
  };
}

function averageField_(rows, field) {
  const values = rows.map(function (row) { return Number(row[field] || 0); }).filter(Boolean);
  return values.length ? round_(values.reduce(function (sum, value) { return sum + value; }, 0) / values.length) : 0;
}

function parseJson_(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return fallback;
  }
}

function localDate_(dateString) {
  const parts = String(dateString || dateKey_(new Date())).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays_(date, days) {
  const output = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  output.setDate(output.getDate() + days);
  return output;
}

function dateKey_(date) {
  return Utilities.formatDate(date, FEEDBACK_REPORTING_CONFIG.timeZone, "yyyy-MM-dd");
}

function sanitizeFeedbackRowForClient_(row) {
  const output = {};

  Object.keys(row || {}).forEach(function(key) {
    const value = row[key];

    if (Object.prototype.toString.call(value) === "[object Date]") {
      output[key] = parseDateTimeForClient_(value);
    } else if (value === undefined || value === null) {
      output[key] = "";
    } else {
      output[key] = value;
    }
  });

  return output;
}

function parseDateTimeForClient_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, FEEDBACK_REPORTING_CONFIG.timeZone, "yyyy-MM-dd HH:mm:ss");
  }

  return String(value == null ? "" : value);
}
