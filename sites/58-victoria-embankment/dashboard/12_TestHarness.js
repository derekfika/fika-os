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
  record("Booking ID generation", testBookingIdGeneration_);

  const failures = results.filter(result => !result.ok);
  return {
    ok: failures.length === 0,
    passed: results.length - failures.length,
    failed: failures.length,
    results
  };
}

function testBookingIdGeneration_() {
  const originalGetConfiguredValue = getConfiguredValue_;

  try {
    getConfiguredValue_ = function() { return "58VE"; };
    const id = generateBookingId_(new Date(2026, 5, 22));
    assertDashboardTest_(
      /^58VE-20260622-\d{3}$/.test(id),
      "Booking ID did not use the configured location short code."
    );

    getConfiguredValue_ = function() { return "undefined"; };
    const fallbackId = generateBookingId_(new Date(2026, 5, 22));
    assertDashboardTest_(
      /^58VE-20260622-\d{3}$/.test(fallbackId),
      "Booking ID did not fall back safely from an invalid short code."
    );
  } finally {
    getConfiguredValue_ = originalGetConfiguredValue;
  }
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
  booking.pax = 12;
  booking.eventDate = "2026-07-14";
  booking.serviceTimes = ["08:30"];
  booking.serviceType = "Breakfast";
  booking.location = "58 Victoria Embankment";
  booking.floor = "7";
  booking.totalPrice = 120;
  booking.mgmtFee = 0;
  booking.netPrice = 120;
  booking.vat = 24;
  booking.grossPrice = 144;
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
  // 58VE retains valid 24-hour values.
  assertDashboardEqual_(parseHospitalityTime_("08:30"),    "08:30", "parseHospitalityTime_: HH:mm passthrough failed.");
  assertDashboardEqual_(parseHospitalityTime_("8:30"),     "08:30", "parseHospitalityTime_: H:mm failed.");
  assertDashboardEqual_(parseHospitalityTime_("7.45"),     "07:45", "parseHospitalityTime_: dotted time failed.");
  assertDashboardEqual_(parseHospitalityTime_("8am"),      "08:00", "parseHospitalityTime_: bare am failed.");
  assertDashboardEqual_(parseHospitalityTime_("8 AM"),     "08:00", "parseHospitalityTime_: spaced AM failed.");
  assertDashboardEqual_(parseHospitalityTime_("8:30pm"),   "20:30", "parseHospitalityTime_: pm conversion failed.");
  assertDashboardEqual_(parseHospitalityTime_("20:30"),    "20:30", "parseHospitalityTime_: 24-hour time failed.");
  assertDashboardEqual_(parseHospitalityTime_("20:00"),    "20:00", "parseHospitalityTime_: evening time failed.");
  assertDashboardEqual_(parseHospitalityTime_("8"),        "08:00", "parseHospitalityTime_: bare integer failed.");
  assertDashboardEqual_(parseHospitalityTime_(""),         "",      "parseHospitalityTime_: empty should return empty.");
  assertDashboardEqual_(parseHospitalityTime_(null),       "",      "parseHospitalityTime_: null should return empty.");
  // Afternoon times that should NOT collapse (12:00 = noon, 13:00-17:xx are fine)
  assertDashboardEqual_(parseHospitalityTime_("12:00"),    "12:00", "parseHospitalityTime_: noon should not collapse.");
  assertDashboardEqual_(parseHospitalityTime_("13:30"),    "13:30", "parseHospitalityTime_: 13:30 should not collapse.");
  assertDashboardEqual_(parseHospitalityTime_("17:00"),    "17:00", "parseHospitalityTime_: 17:00 should not collapse.");
  assertDashboardEqual_(parseHospitalityTime_("6pm-10pm"), "18:00", "Time range should use the starting time.");
  assertDashboardEqual_(parseHospitalityTime_("6pm – 10pm"), "18:00", "Spaced time range should use the starting time.");
  assertDashboardEqual_(parseHospitalityTime_("18:30-22:00"), "18:30", "24-hour range should use the starting time.");
  assertDashboardEqual_(parseHospitalityTime_("6-10pm"), "18:00", "Shared-meridian range should infer the starting meridian.");
  assertDashboardEqual_(parseHospitalityTime_("11-1pm"), "11:00", "Range crossing noon should infer an AM start.");
  assertDashboardEqual_(parseHospitalityTime_("42:00"), "18:00", "Elapsed Excel time should roll over to clock time.");
  assertDashboardEqual_(parseHospitalityTime_("47:00"), "23:00", "Elapsed Excel time rollover failed.");
  assertDashboardEqual_(parseHospitalityTime_("18:75"), "", "Invalid minutes should be rejected.");

  // ── Aliases (backwards-compat) ───────────────────────────────────────────
  assertDashboardEqual_(normaliseHospitalityTime_("20:30"), "20:30", "normaliseHospitalityTime_ alias: late time failed.");
  assertDashboardEqual_(normaliseTimeText_("7.45"),         "07:45", "normaliseTimeText_ alias: dotted time failed.");

  // ── extractTimeFromText_ (finds first time in free text) ────────────────
  assertDashboardEqual_(extractTimeFromText_("Breakfast at 8am"),    "08:00", "extractTimeFromText_: bare am failed.");
  assertDashboardEqual_(extractTimeFromText_("Service 08:30 pm"),    "20:30", "extractTimeFromText_: pm conversion failed.");
  assertDashboardEqual_(extractTimeFromText_("Delivery 09:00"),      "09:00", "extractTimeFromText_: bare HH:mm failed.");
  assertDashboardEqual_(extractTimeFromText_("Event runs 6pm-10pm"), "18:00", "extractTimeFromText_: range should use start.");
  assertDashboardEqual_(extractTimeFromText_("Nothing here"),        "",      "extractTimeFromText_: no time should return empty.");

  // ── parseHospitalityDate_ ────────────────────────────────────────────────
  assertDashboardEqual_(parseHospitalityDate_("14.06.2026"),   "2026-06-14", "parseHospitalityDate_: dd.mm.yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14/06/2026"),   "2026-06-14", "parseHospitalityDate_: dd/mm/yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14-06-2026"),   "2026-06-14", "parseHospitalityDate_: dd-mm-yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14.06.26"),     "2026-06-14", "parseHospitalityDate_: dd.mm.yy failed.");
  assertDashboardEqual_(parseHospitalityDate_("2026-06-14"),   "2026-06-14", "parseHospitalityDate_: ISO pass-through failed.");
  assertDashboardEqual_(parseHospitalityDate_("14 June 2026"), "2026-06-14", "parseHospitalityDate_: dd MMMM yyyy failed.");
  assertDashboardEqual_(parseHospitalityDate_("14 Jun 2026"),  "2026-06-14", "parseHospitalityDate_: dd MMM yyyy failed.");
  assertDashboardEqual_(extractDateFromText_("External Booking Form 16.06.26 Jacobs.xlsx"), "2026-06-16", "Filename date extraction failed.");
  assertDashboardEqual_(parseHospitalityDate_(""),             "",           "parseHospitalityDate_: empty should return empty.");
  assertDashboardEqual_(parseHospitalityDate_(null),           "",           "parseHospitalityDate_: null should return empty.");

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
  assertDashboardEqual_(infer58VeSectionFromRow_(17), "Refreshments", "58VE refreshments row mapping failed.");
  assertDashboardEqual_(infer58VeSectionFromRow_(30), "Breakfast", "58VE breakfast row mapping failed.");
  assertDashboardEqual_(infer58VeSectionFromRow_(34), "Lunch", "58VE lunch row mapping failed.");
  assertDashboardEqual_(infer58VeSectionFromRow_(46), "Events Catering", "58VE events row mapping failed.");

  const fingerprint = makeBookingFingerprint_({
    eventDate: "2026-06-16",
    clientCompany: "Jacobs Media",
    pax: 100,
    serviceTimes: ["15:00"],
    floor: "Ground Floor"
  });
  assertDashboardEqual_(
    fingerprint,
    "2026 06 16|jacobs media|100|15 00|ground floor",
    "Booking fingerprint generation failed."
  );
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

  assertDashboardTest_(
    shouldArchiveBooking_({ eventDate: "2020-01-01", status: CONFIG.STATUS.NEEDS_REVIEW }),
    "Historic NEEDS_REVIEW imports should archive immediately."
  );
  assertDashboardTest_(
    !shouldArchiveBooking_({ eventDate: "2099-01-01", status: CONFIG.STATUS.NEEDS_REVIEW }),
    "Future NEEDS_REVIEW imports should remain active."
  );
}

function testQuoteHelpers_() {
  const booking = makeDashboardTestBooking_();

  assertDashboardEqual_(makeQuoteName_(booking), "Quote - Example Client - 2026-07-14", "Quote name failed.");
  assertDashboardEqual_(formatMoney_(12.5), "GBP 12.50", "Money formatting failed.");
  assertDashboardEqual_(formatUkDate_("2026-07-14"), "14/07/2026", "UK date formatting failed.");
  assertDashboardEqual_(extractDriveIdFromUrl_("https://docs.google.com/document/d/abc1234567890123456789012/edit"), "abc1234567890123456789012", "Drive ID extraction failed.");
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
