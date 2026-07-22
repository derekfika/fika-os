function sendDueFeedbackRequests() {
  const contexts = getFeedbackSiteContexts_();
  const result = { ok: true, sent: 0, sites: [], errors: [] };
  if (!contexts.length) {
    throw new Error("No feedback sites are configured in Script Properties.");
  }

  contexts.forEach(function(context) {
    try {
      const siteResult = sendDueFeedbackRequestsForSite_(context);
      result.sites.push(siteResult);
      result.sent += siteResult.sent;
      result.errors = result.errors.concat(siteResult.errors);
    } catch (error) {
      result.errors.push(context.site.siteId + ": " + error.message);
    }
  });
  result.ok = result.errors.length === 0;
  return result;
}

function sendDueFeedbackRequestsForSite_(context) {
  const spreadsheet = context.spreadsheet;
  const site = context.site;
  const dashboard = spreadsheet.getSheetByName(site.dashboardSheetName);
  const requests = spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.requests);
  if (!dashboard || !requests) {
    throw new Error("Run setupFeedbackPortal('" + site.siteId + "') first.");
  }

  const dashboardMap = feedbackHeaderMap_(dashboard);
  if (!dashboardMap.ParsedJSON || !dashboardMap.Status) {
    throw new Error("Dashboard Data requires ParsedJSON and Status columns.");
  }
  const existing = getExistingFeedbackBookingMap_(requests);
  const rows = dashboard.getLastRow() > 1
    ? dashboard.getRange(2, 1, dashboard.getLastRow() - 1, dashboard.getLastColumn()).getValues()
    : [];
  const now = new Date();
  let sent = 0;
  const errors = [];

  rows.forEach(function(row) {
    const booking = feedbackJson_(row[dashboardMap.ParsedJSON - 1], null);
    if (!booking || !booking.bookingId) return;
    const priorRequest = existing[booking.bookingId];
    if (priorRequest && priorRequest.sent) return;
    const status = String(row[dashboardMap.Status - 1] || "").trim().toUpperCase();
    const eligibleStatuses = site.eligibleStatuses || FEEDBACK_CONFIG.eligibleStatuses;
    if (eligibleStatuses.indexOf(status) === -1) return;
    if (!booking.hostEmail) return;

    const due = getFeedbackRequestDueDate_(
      booking,
      site.requestDelayHours || FEEDBACK_CONFIG.requestDelayHours
    );
    if (!due || now < due) return;
    const expires = new Date(
      due.getTime() +
      (site.requestExpiryHours || FEEDBACK_CONFIG.requestExpiryHours) * 3600000
    );
    if (now > expires) return;

    try {
      const token = priorRequest ? priorRequest.token : generateFeedbackToken_();
      const requestRow = priorRequest
        ? priorRequest.rowNumber
        : appendFeedbackRequest_(requests, booking, token, due, site.siteId);
      sendFeedbackRequestEmail_(context, booking, token);
      markFeedbackRequestSent_(requests, requestRow);
      existing[booking.bookingId] = {
        rowNumber: requestRow,
        token: token,
        sent: true
      };
      sent++;
    } catch (error) {
      errors.push(site.siteId + "/" + booking.bookingId + ": " + error.message);
    }
  });

  return { siteId: site.siteId, sent: sent, errors: errors };
}

function getFeedbackRequestDueDate_(booking, delayHours) {
  const date = String(booking.eventDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const clientEvent = (booking.clientBooking || {}).event || {};
  const time = clientEvent.endTime ||
    (booking.serviceTimes && booking.serviceTimes[0]) ||
    "17:00";
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  const parts = date.split("-").map(Number);
  const hours = match ? Number(match[1]) : 17;
  const minutes = match ? Number(match[2]) : 0;
  const eventEnd = new Date(parts[0], parts[1] - 1, parts[2], hours, minutes);
  return new Date(
    eventEnd.getTime() +
    Number(delayHours || FEEDBACK_CONFIG.requestDelayHours) * 3600000
  );
}

function generateFeedbackToken_() {
  return Utilities.base64EncodeWebSafe(
    Utilities.getUuid() + Utilities.getUuid()
  ).replace(/=+$/g, "");
}

function appendFeedbackRequest_(sheet, booking, token, due, siteId) {
  const rowNumber = sheet.getLastRow() + 1;
  sheet.appendRow([
    token, booking.bookingId, booking.hostEmail, booking.hostName || "",
    booking.eventDate, booking.serviceType || "", due, false, "",
    false, "", false, "", JSON.stringify(booking), siteId
  ]);
  return rowNumber;
}

function markFeedbackRequestSent_(sheet, rowNumber) {
  const map = feedbackHeaderMap_(sheet);
  sheet.getRange(rowNumber, map["Request Sent"]).setValue(true);
  sheet.getRange(rowNumber, map["Request Sent Date"]).setValue(new Date());
}

function getExistingFeedbackBookingMap_(sheet) {
  const result = {};
  if (sheet.getLastRow() < 2) return result;
  const map = feedbackHeaderMap_(sheet);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues().forEach(function(row, index) {
      const bookingReference = String(row[map["Booking Reference"] - 1] || "");
      if (!bookingReference) return;
      result[bookingReference] = {
        rowNumber: index + 2,
        token: String(row[map["Feedback Token"] - 1] || ""),
        sent: feedbackBoolean_(row[map["Request Sent"] - 1])
      };
    });
  return result;
}

function installFeedbackRequestTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === "sendDueFeedbackRequests";
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  ScriptApp.newTrigger("sendDueFeedbackRequests")
    .timeBased()
    .everyHours(6)
    .create();
  return { ok: true, message: "Multi-site feedback request trigger installed." };
}
