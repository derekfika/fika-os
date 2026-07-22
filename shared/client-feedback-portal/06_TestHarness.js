function runFeedbackPortalTests() {
  const tests = [];
  function record(name, condition) {
    tests.push({ name: name, ok: Boolean(condition) });
  }
  record("Spreadsheet URL extraction",
    extractFeedbackSpreadsheetId_("https://docs.google.com/spreadsheets/d/1ExampleSpreadsheetId123456789/edit") ===
    "1ExampleSpreadsheetId123456789");
  record("Rating validation", feedbackRating_(5) === 5 && feedbackRating_(6) === 0);
  record("NPS validation", feedbackNps_(0) === 0 && feedbackNps_(10) === 10);
  record("Item normalisation", normaliseFeedbackItems_([
    { itemId: "pastries", name: "Mini Pastries", qty: 2 }
  ])[0].quantity === 2);
  record("Due date calculation", Boolean(getFeedbackRequestDueDate_({
    eventDate: "2030-06-22",
    serviceTimes: ["09:00"],
    clientBooking: { event: { endTime: "10:00" } }
  })));
  record("Confirmed status is the only eligible status",
    FEEDBACK_SITES.angel_court.eligibleStatuses.length === 1 &&
    FEEDBACK_SITES.angel_court.eligibleStatuses[0] === "CONFIRMED");
  record("Angel Court registry entry",
    FEEDBACK_SITES.angel_court.siteId === "angel_court" &&
    FEEDBACK_SITES.angel_court.spreadsheetPropertyKey ===
      "ANGEL_COURT_DASHBOARD_SPREADSHEET_ID");
  return {
    ok: tests.every(function(test) { return test.ok; }),
    tests: tests
  };
}

function emailRandomArchivedFeedbackLinkToDerek(siteId) {
  const context = getFeedbackSiteContext_(siteId || "angel_court");
  const spreadsheet = context.spreadsheet;
  const site = context.site;
  const dashboard = spreadsheet.getSheetByName(site.dashboardSheetName);
  const requests = spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.requests);
  if (!dashboard || !requests) {
    throw new Error("Run setupFeedbackPortal('" + site.siteId + "') first.");
  }
  const settings = getFeedbackSettings_(context);
  if (!/^https:\/\/\S+\/exec(?:\?|$)/i.test(String(settings.FEEDBACK_WEB_APP_URL || "").trim())) {
    throw new Error(
      "FEEDBACK_WEB_APP_URL is missing. Run setFeedbackWebAppUrl(\"PASTE_DEPLOYED_EXEC_URL_HERE\") " +
      "or paste the feedback portal /exec URL into Feedback Settings."
    );
  }

  const candidates = getArchivedFeedbackTestCandidates_(dashboard);
  if (!candidates.length) {
    throw new Error(
      "No archived bookings with valid ParsedJSON were found in '" +
      site.dashboardSheetName + "'."
    );
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  const token = generateFeedbackToken_();
  const due = new Date();
  const requestRow = appendFeedbackRequest_(
    requests,
    selected.booking,
    token,
    due,
    site.siteId
  );
  sendFeedbackRequestEmail_(
    context,
    selected.booking,
    token,
    "derek@fikacatering.com"
  );
  markFeedbackRequestSent_(requests, requestRow);

  return {
    ok: true,
    message: "Test feedback link emailed to derek@fikacatering.com.",
    siteId: site.siteId,
    bookingReference: selected.booking.bookingId,
    dashboardRow: selected.dashboardRow,
    feedbackRequestRow: requestRow
  };
}

function getArchivedFeedbackTestCandidates_(dashboard) {
  const map = feedbackHeaderMap_(dashboard);
  if (!map.ParsedJSON || !map.Status) {
    throw new Error("Dashboard Data requires ParsedJSON and Status columns.");
  }
  if (dashboard.getLastRow() < 2) return [];
  return dashboard
    .getRange(2, 1, dashboard.getLastRow() - 1, dashboard.getLastColumn())
    .getValues()
    .map(function(row, index) {
      const status = String(row[map.Status - 1] || "").trim().toUpperCase();
      if (status !== "ARCHIVED") return null;
      const booking = feedbackJson_(row[map.ParsedJSON - 1], null);
      if (!booking || !booking.bookingId) return null;
      return {
        booking: booking,
        dashboardRow: index + 2
      };
    })
    .filter(Boolean);
}
