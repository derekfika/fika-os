function runDashboardPureTests() {
  const results = [];

  function record(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  record("Settings validation", testDashboardSettingsValidation);
  record("Parser edge cases", testParserEdgeCases_);
  record("Email generation", testEmailGeneration_);
  record("Archive logic", testArchiveLogic_);
  record("Quote helper functions", testQuoteHelpers_);
  record("Calendar helper functions", testCalendarHelpers_);
  record("Status validation", testStatusValidation_);
  record("Settings draft column aliases", testSettingsDraftColumnAliases_);
  record("Locked status validation", testLockedStatusValidation_);

  const failures = results.filter(result => !result.ok);
  return {
    ok: failures.length === 0,
    passed: results.length - failures.length,
    failed: failures.length,
    results
  };
}

function getDashboardLiveTestChecklist() {
  return [
    {
      area: "Scanner imports booking",
      run: "prepareInboxScan, then scanInboxChunk(0, 1)",
      expected: "A valid XLSX booking creates one Dashboard Data row with ParsedJSON, MessageId, AttachmentName, and READY or NEEDS_REVIEW status."
    },
    {
      area: "Duplicate prevention",
      run: "scanInboxChunk(0, 1) again against the same message/attachment",
      expected: "No second row is written for the same MessageId + AttachmentName key."
    },
    {
      area: "Quote generation functions",
      run: "generateQuoteForRow(rowNumber) on a READY booking",
      expected: "A quote document is created or updated, quoteUrl is saved, and status becomes QUOTE_GENERATED."
    },
    {
      area: "Calendar creation functions",
      run: "createCalendarEventForRow(rowNumber) after quote generation",
      expected: "A calendar event is created with quote and original XLSX attachments, and status becomes CPU_CREATED."
    },
    {
      area: "Settings persistence",
      run: "Open Settings, change a harmless text value, save, refresh web app",
      expected: "The saved value remains in the modal and any linked dashboard text/style updates after refresh."
    },
    {
      area: "Email generation functions",
      run: "confirmBookingForRow(rowNumber) or cancelBookingForRow(rowNumber, { sendEmail: true }) on a safe test booking",
      expected: "Email sends to the booking host with the expected subject/body and the row records the action."
    },
    {
      area: "Archive logic",
      run: "Set ARCHIVE_AFTER_DAYS, scan/import an old test booking",
      expected: "Old bookings become ARCHIVED; current/future bookings do not."
    },
    {
      area: "Filters",
      run: "Use the dashboard status checkboxes and search input",
      expected: "Rows narrow by selected status and free-text search, then restore when filters clear."
    }
  ];
}

function assertDashboardTest_(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDashboardEqual_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message + ` Expected '${expected}', got '${actual}'.`);
  }
}

function makeDashboardTestBooking_() {
  const booking = createEmptyBooking_();
  booking.bookingId = "TEST-BOOKING-001";
  booking.clientCompany = "Example Client";
  booking.hostName = "Alex Example";
  booking.hostEmail = "alex@example.com";
  booking.invoiceReference = "PO-12345";
  booking.pax = 12;
  booking.eventDate = "2026-07-14";
  booking.serviceTimes = ["08:30"];
  booking.serviceType = "Breakfast";
  booking.location = "One Angel Court";
  booking.floor = "7";
  booking.totalPrice = 120;
  booking.mgmtFee = 9.6;
  booking.netPrice = 129.6;
  booking.vat = 25.92;
  booking.grossPrice = 155.52;
  booking.items = [
    { section: "Food", name: "Pastries", qty: 12, time: "08:30" }
  ],
  booking.status = CONFIG.STATUS.NEW;
  return booking;
}

function testParserEdgeCases_() {
  // Email helpers
  assertDashboardEqual_(extractEmailAddress_('"Alex Example" <alex@example.com>'), "alex@example.com", "Email extraction failed.");
  assertDashboardEqual_(extractEmailName_("alex.example@example.com"), "Alex Example", "Email-name fallback failed.");

  // ── parseHospitalityTime_ (canonical) ───────────────────────────────────
  // The hospitaliy collapse (18-23 → 06-11) is intentional for Angel Court.
  // "8:30pm" = 20:30 in 24-hr → collapses to 08:30.
  assertDashboardEqual_(parseHospitalityTime_("08:30"),    "08:30", "parseHospitalityTime_: HH:mm passthrough failed.");
  assertDashboardEqual_(parseHospitalityTime_("8:30"),     "08:30", "parseHospitalityTime_: H:mm failed.");
  assertDashboardEqual_(parseHospitalityTime_("7.45"),     "07:45", "parseHospitalityTime_: dotted time failed.");
  assertDashboardEqual_(parseHospitalityTime_("8am"),      "08:00", "parseHospitalityTime_: bare am failed.");
  assertDashboardEqual_(parseHospitalityTime_("8 AM"),     "08:00", "parseHospitalityTime_: spaced AM failed.");
  assertDashboardEqual_(parseHospitalityTime_("8:30pm"),   "08:30", "parseHospitalityTime_: 8:30pm → 20:30 → collapse to 08:30 failed.");
  assertDashboardEqual_(parseHospitalityTime_("20:30"),    "08:30", "parseHospitalityTime_: late 24-hr collapse failed.");
  assertDashboardEqual_(parseHospitalityTime_("20:00"),    "08:00", "parseHospitalityTime_: 20:00 collapse failed.");
  assertDashboardEqual_(parseHospitalityTime_("8"),        "08:00", "parseHospitalityTime_: bare integer failed.");
  assertDashboardEqual_(parseHospitalityTime_(""),         "",      "parseHospitalityTime_: empty should return empty.");
  assertDashboardEqual_(parseHospitalityTime_(null),       "",      "parseHospitalityTime_: null should return empty.");
  // Afternoon times that should NOT collapse (12:00 = noon, 13:00-17:xx are fine)
  assertDashboardEqual_(parseHospitalityTime_("12:00"),    "12:00", "parseHospitalityTime_: noon should not collapse.");
  assertDashboardEqual_(parseHospitalityTime_("13:30"),    "13:30", "parseHospitalityTime_: 13:30 should not collapse.");
  assertDashboardEqual_(parseHospitalityTime_("17:00"),    "17:00", "parseHospitalityTime_: 17:00 should not collapse.");

  // ── Aliases (backwards-compat) ───────────────────────────────────────────
  assertDashboardEqual_(normaliseHospitalityTime_("20:30"), "08:30", "normaliseHospitalityTime_ alias: late time failed.");
  assertDashboardEqual_(normaliseTimeText_("7.45"),         "07:45", "normaliseTimeText_ alias: dotted time failed.");

  // ── extractTimeFromText_ (finds first time in free text) ────────────────
  assertDashboardEqual_(extractTimeFromText_("Breakfast at 8am"),    "08:00", "extractTimeFromText_: bare am failed.");
  // "08:30 pm" = 20:30 → hospitality collapse → 08:30
  assertDashboardEqual_(extractTimeFromText_("Service 08:30 pm"),    "08:30", "extractTimeFromText_: pm collapses correctly.");
  assertDashboardEqual_(extractTimeFromText_("Delivery 09:00"),      "09:00", "extractTimeFromText_: bare HH:mm failed.");
  assertDashboardEqual_(extractTimeFromText_("Nothing here"),        "",      "extractTimeFromText_: no time should return empty.");

  // ── parseHospitalityDate_ ────────────────────────────────────────────────
  assertDashboardEqual_(parseHospitalityDate_("14.06.2026"),   "2026-06-14", "parseHospitalityDate_: dd.mm.yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14/06/2026"),   "2026-06-14", "parseHospitalityDate_: dd/mm/yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14-06-2026"),   "2026-06-14", "parseHospitalityDate_: dd-mm-yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14.06.26"),     "2026-06-14", "parseHospitalityDate_: dd.mm.yy failed.");
  assertDashboardEqual_(parseHospitalityDate_("2026-06-14"),   "2026-06-14", "parseHospitalityDate_: ISO pass-through failed.");
  assertDashboardEqual_(parseHospitalityDate_("14 June 2026"), "2026-06-14", "parseHospitalityDate_: dd MMMM yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14 Jun 2026"),  "2026-06-14", "parseHospitalityDate_: dd MMM yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_(""),             "",           "parseHospitalityDate_: empty should return empty.");
  assertDashboardEqual_(parseHospitalityDate_(null),           "",           "parseHospitalityDate_: null should return empty.");

  // Email subject consistency and stale-form recovery
  const bookingSubject = "Lunch | 05.08.26 | 8ppl | lunch for 11:30am | Arrow Global Meeting";
  assertDashboardEqual_(extractDateFromText_(bookingSubject), "2026-08-05", "Subject date extraction failed.");
  assertDashboardEqual_(extractPaxFromText_(bookingSubject), 8, "Subject pax extraction failed.");

  const staleFormBooking = makeDashboardTestBooking_();
  staleFormBooking.eventDate = "2026-07-21";
  staleFormBooking.pax = 10;
  staleFormBooking.serviceTimes = ["11:30"];

  applyEmailSubjectConsistencyChecks_(
    staleFormBooking,
    bookingSubject,
    new Date(2026, 6, 27)
  );

  assertDashboardEqual_(staleFormBooking.eventDate, "2026-08-05", "Future subject date should replace a past workbook date.");
  assertDashboardEqual_(staleFormBooking.sourceConsistency.eventDateAutoCorrected, true, "Stale workbook date should be marked as auto-corrected.");
  assertDashboardEqual_(staleFormBooking.sourceConsistencyIssues.length, 1, "Only the pax mismatch should remain after date recovery.");
  assertDashboardTest_(hasUnreviewedSourceConsistencyIssues_(staleFormBooking), "Pax mismatch should require review.");
  assertDashboardEqual_(validateBooking_(staleFormBooking).status, CONFIG.STATUS.NEEDS_REVIEW, "Recovered booking with a pax mismatch should need review.");

  staleFormBooking.sourceConsistencyReviewed = true;
  assertDashboardEqual_(validateBooking_(staleFormBooking).status, CONFIG.STATUS.READY, "A manually reviewed source mismatch should no longer block readiness.");

  const currentFormBooking = makeDashboardTestBooking_();
  currentFormBooking.eventDate = "2026-08-04";
  applyEmailSubjectConsistencyChecks_(
    currentFormBooking,
    "Lunch | 05.08.26 | 12ppl | 08:30",
    new Date(2026, 6, 27)
  );
  assertDashboardEqual_(currentFormBooking.eventDate, "2026-08-04", "A non-past workbook date should not be silently replaced.");
  assertDashboardTest_(currentFormBooking.sourceConsistencyIssues.length > 0, "A non-stale date conflict should require review.");

  const futureWorkbookBooking = makeDashboardTestBooking_();
  futureWorkbookBooking.eventDate = "2026-08-05";
  applyEmailSubjectConsistencyChecks_(
    futureWorkbookBooking,
    "Lunch | 21.07.26 | 12ppl | 08:30",
    new Date(2026, 6, 27)
  );
  assertDashboardEqual_(futureWorkbookBooking.eventDate, "2026-08-05", "The future workbook date should remain canonical when the subject date is past.");
  assertDashboardEqual_(futureWorkbookBooking.sourceConsistencyIssues.length, 0, "A past-versus-future date conflict should auto-resolve to the future date.");

  // ── normaliseBookingTimes_ forward-fill ──────────────────────────────────
  const testBooking = {
    serviceTimes: ["08:30"],
    items: [
      { time: "08:30", name: "Item A" },
      { time: "",      name: "Item B" },  // blank — should forward-fill
      { time: null,    name: "Item C" },  // null — should forward-fill
      { time: "09:00", name: "Item D" },  // explicit new time
      { time: "",      name: "Item E" }   // should pick up 09:00
    ]
  };
  const filled = normaliseBookingTimes_(testBooking);
  assertDashboardEqual_(filled.items[0].time, "08:30", "normaliseBookingTimes_: item 0 time failed.");
  assertDashboardEqual_(filled.items[1].time, "08:30", "normaliseBookingTimes_: blank item should forward-fill from previous.");
  assertDashboardEqual_(filled.items[2].time, "08:30", "normaliseBookingTimes_: null item should forward-fill.");
  assertDashboardEqual_(filled.items[3].time, "09:00", "normaliseBookingTimes_: explicit time should be respected.");
  assertDashboardEqual_(filled.items[4].time, "09:00", "normaliseBookingTimes_: blank after explicit should pick up explicit.");

  // ── Other parser helpers ─────────────────────────────────────────────────
  assertDashboardEqual_(parseRequiredQty_("Approx 12 portions"), 12, "Quantity parsing failed.");
  assertDashboardEqual_(splitOrderNameAndDetail_("Fruit platter - vegan option").name, "Fruit platter", "Order/detail split failed.");
}

function testEmailGeneration_() {
  const booking = makeDashboardTestBooking_();
  const confirmationSubject = buildConfirmationSubject_(booking);
  const confirmationHtml = buildConfirmationEmailHtml_(booking);
  const cancellationHtml = buildCancellationEmailHtml_(booking);

  assertDashboardTest_(confirmationSubject.indexOf("Booking Confirmed") !== -1, "Confirmation subject is missing status text.");
  assertDashboardTest_(confirmationHtml.indexOf("Example Client") !== -1, "Confirmation email is missing client company.");
  assertDashboardTest_(confirmationHtml.indexOf("Pastries") !== -1, "Confirmation email is missing itemised order lines.");
  assertDashboardTest_(confirmationHtml.indexOf("GBP") === -1, "Confirmation email should not include prices.");
  assertDashboardTest_(confirmationHtml.indexOf("TEST-BOOKING-001") !== -1, "Confirmation email is missing booking reference.");
  assertDashboardTest_(cancellationHtml.indexOf("Booking Cancelled") !== -1, "Cancellation email is missing heading.");
  assertDashboardTest_(stripHtml_(confirmationHtml).indexOf("<") === -1, "HTML stripping left tags behind.");
}

function testArchiveLogic_() {
  const today = new Date(2026, 5, 13);
  today.setHours(0, 0, 0, 0);

  assertDashboardTest_(isBookingOlderThanArchiveThreshold_("2026-06-12", 0, today), "Yesterday should archive when threshold is 0.");
  assertDashboardTest_(!isBookingOlderThanArchiveThreshold_("2026-06-13", 0, today), "Today should not archive when threshold is 0.");
  assertDashboardTest_(!isBookingOlderThanArchiveThreshold_("2026-06-12", 2, today), "Yesterday should not archive when threshold is 2 days.");
  assertDashboardTest_(isBookingOlderThanArchiveThreshold_("2026-06-10", 2, today), "Three days ago should archive when threshold is 2 days.");
  assertDashboardTest_(!isBookingOlderThanArchiveThreshold_("bad-date", 0, today), "Bad dates should not archive.");
}

function testQuoteHelpers_() {
  const booking = makeDashboardTestBooking_();
  booking.notes = "1x No Onions";
  const replacements = getQuoteReplacements_(booking);

  assertDashboardEqual_(replacements["<SITE>"], "OAC", "Quote site replacement failed.");
  assertDashboardEqual_(replacements["<CLIENT>"], "Example Client", "Quote client replacement failed.");
  assertDashboardEqual_(makeQuoteName_(booking), "OAC_Example Client_Alex Example_Breakfast", "Quote name failed.");
  assertDashboardEqual_(replacements["<MGMTFEE>"], "GBP 9.60", "Quote management fee replacement failed.");
  assertDashboardEqual_(replacements["<NOTES>"], "1x No Onions", "Quote dietary requirements replacement failed.");
  assertDashboardTest_(
    ["<SITE>", "<CLIENT>", "<MGMTFEE>"].every(function(token) {
      return Object.prototype.hasOwnProperty.call(replacements, token);
    }),
    "Required quote replacements should include site, client and management fee."
  );
  assertDashboardTest_(
    getRequiredQuoteTokens_(booking).indexOf("<NOTES>") !== -1,
    "Quotes with dietary requirements must require the notes placeholder."
  );
  booking.notes = "";
  assertDashboardTest_(
    getRequiredQuoteTokens_(booking).indexOf("<NOTES>") === -1,
    "Quotes without dietary requirements should not require the notes placeholder."
  );
  const recalculated = recalculateDashboardTotals_({
    items: [{ name: "Pastries", qty: 12, unitPrice: 10 }]
  }, 0.08);
  assertDashboardEqual_(recalculated.mgmtFee, 9.6, "Quote generation should add the 8% management fee.");
  booking.serviceType = "Drinks / Lunch / Add-on Packages";
  assertDashboardEqual_(getPrimaryQuoteServiceType_(booking), "Lunch", "Lunch should take precedence over drinks and add-ons.");
  assertDashboardEqual_(makeQuoteName_(booking), "OAC_Example Client_Alex Example_Lunch", "Primary-service quote name failed.");
  booking.serviceType = "Add-on Packages / Breakfast / Drinks";
  assertDashboardEqual_(getPrimaryQuoteServiceType_(booking), "Breakfast", "Breakfast should take precedence over drinks and add-ons.");
  booking.serviceType = "Drinks / Add-on Packages";
  assertDashboardEqual_(getPrimaryQuoteServiceType_(booking), "Drinks", "Secondary-only service fallback failed.");
  assertDashboardEqual_(formatMoney_(12.5), "GBP 12.50", "Money formatting failed.");
  assertDashboardEqual_(formatUkDate_("2026-07-14"), "14/07/2026", "UK date formatting failed.");
  assertDashboardEqual_(extractDriveIdFromUrl_("https://docs.google.com/document/d/abc1234567890123456789012/edit"), "abc1234567890123456789012", "Drive ID extraction failed.");
  assertDashboardEqual_(booking.invoiceReference, "PO-12345", "Invoice reference fixture failed.");
}

function testCalendarHelpers_() {
  const booking = makeDashboardTestBooking_();
  const start = buildCalendarStart_("2026-07-14", "08:30");

  assertDashboardEqual_(start.getFullYear(), 2026, "Calendar start year failed.");
  assertDashboardEqual_(start.getMonth(), 6, "Calendar start month failed.");
  assertDashboardEqual_(start.getDate(), 14, "Calendar start date failed.");
  assertDashboardEqual_(start.getHours(), 8, "Calendar start hour failed.");
  assertDashboardTest_(makeCalendarTitle_(booking).indexOf("Example Client") !== -1, "Calendar title missing company.");
  const now = new Date(2026, 6, 11, 9, 0, 0, 0);
  const within72Hours = new Date(now.getTime() + 71 * 60 * 60 * 1000);
  const outside72Hours = new Date(now.getTime() + 73 * 60 * 60 * 1000);
  assertDashboardTest_(shouldWarnForStaleCalendarRegeneration_(true, within72Hours, now), "Stale calendar warning should apply within 72 hours.");
  assertDashboardTest_(!shouldWarnForStaleCalendarRegeneration_(true, outside72Hours, now), "Stale calendar warning should not apply outside 72 hours.");
  assertDashboardTest_(!shouldWarnForStaleCalendarRegeneration_(false, within72Hours, now), "New calendar events should not receive the stale warning.");
  assertDashboardTest_(makeCalendarEventTitle_(booking, true).indexOf("WARNING ") === 0, "Calendar warning should be first in the title.");
  assertDashboardTest_(makeCalendarEventDescription_("Original notes", true).indexOf(STALE_CALENDAR_WARNING_NOTE) === 0, "Calendar warning should be first in the notes.");

  const attendees = parseCalendarAttendees_(
    "one@example.com\n two@example.com;three@example.com,one@example.com"
  );
  assertDashboardEqual_(attendees.valid.length, 3, "Calendar attendee splitting or deduplication failed.");
  assertDashboardEqual_(attendees.invalid.length, 0, "Valid calendar attendees were rejected.");

  const invalidAttendees = parseCalendarAttendees_("valid@example.com\nnot-an-email");
  assertDashboardEqual_(invalidAttendees.valid.length, 1, "Valid attendee was not retained.");
  assertDashboardEqual_(invalidAttendees.invalid[0], "not-an-email", "Invalid attendee was not reported.");

  assertDashboardEqual_(normaliseCalendarColorId_("9"), "9", "Valid calendar colour failed.");
  assertDashboardEqual_(normaliseCalendarColorId_("99"), "", "Invalid calendar colour should be omitted.");
  assertDashboardEqual_(
    makeBookingJsonFileName_(booking),
    "Booking Object - TEST-BOOKING-001.json",
    "Booking JSON filename failed."
  );
  const bookingJson = JSON.parse(serialiseBookingJson_(booking));
  assertDashboardEqual_(bookingJson.bookingId, booking.bookingId, "Booking JSON serialization failed.");
}

function testStatusValidation_() {
  const booking = makeDashboardTestBooking_();
  const valid = validateBooking_(booking);

  assertDashboardEqual_(valid.status, CONFIG.STATUS.READY, "Complete booking should be READY.");

  valid.clientCompany = "";
  const invalid = validateBooking_(valid);

  assertDashboardEqual_(invalid.status, CONFIG.STATUS.NEEDS_REVIEW, "Incomplete booking should need review.");
  assertDashboardTest_(invalid.validationErrors.indexOf("Missing company") !== -1, "Missing company validation failed.");
}

function testSettingsDraftColumnAliases_() {
  const headers = ["tab", "setting key", "current value", "notes"];

  assertDashboardEqual_(findSettingsDraftColumn_(headers, ["key", "setting key"]), 1, "Setting key alias failed.");
  assertDashboardEqual_(findSettingsDraftColumn_(headers, ["value", "current value"]), 2, "Current value alias failed.");
  assertDashboardEqual_(findSettingsDraftColumn_(headers, ["missing"]), -1, "Missing alias should return -1.");
}

function testLockedStatusValidation_() {
  const booking = makeDashboardTestBooking_();
  booking.status = CONFIG.STATUS.CONFIRMED;
  booking.clientCompany = "";

  const validated = validateBooking_(booking);

  assertDashboardEqual_(
    validated.status,
    CONFIG.STATUS.CONFIRMED,
    "validateBooking_ should not overwrite locked CONFIRMED status."
  );

  assertDashboardTest_(
    validated.validationErrors.indexOf("Missing company") !== -1,
    "Locked status booking should still record validation errors."
  );
}

assertDashboardEqual_(
  parseHospitalityDate_("31/02/2026"),
  "",
  "Invalid calendar dates should not roll over."
);
