// =============================================================================
// PARSER — Angel Court booking XLSX → booking object
// =============================================================================
// TIME / DATE ARCHITECTURE
// ------------------------
// One canonical function handles all inbound time text:
//
//   parseHospitalityTime_(raw)  →  "HH:mm"  or  ""
//
// It accepts every format seen in the wild:
//   • Google Sheets Date objects      (extracts HH:mm via Utilities.formatDate)
//   • "08:30" / "8:30" / "08.30"      (already HH:mm or H.mm)
//   • "8am" / "8 AM" / "8:30pm"       (12-hr with meridian)
//   • "20:30" etc. (18-23 range)       (Angel Court 12-hr data stored as 24-hr)
//   • bare hour integers               ("8", "9")
//
// Everything else in this file delegates to parseHospitalityTime_().
// forceLateHospitalityTimeToMorning_() and normaliseTimeText_() are removed;
// normaliseHospitalityTime_() is kept as a thin alias so callers that
// reference it by name continue to work without change.
//
// One canonical function handles all inbound date text:
//
//   parseHospitalityDate_(raw)  →  "yyyy-MM-dd"  or  ""
//
// It accepts every date format seen in booking forms and sheet names.
// parseDateToIsoDate_() and parseFlexibleDateTime_() now delegate to it.
// =============================================================================


// ---------------------------------------------------------------------------
// CANONICAL TIME PARSER
// ---------------------------------------------------------------------------

/**
 * Parses any time representation found in Angel Court booking forms and
 * returns a normalised "HH:mm" string (24-hour, zero-padded).
 *
 * Returns "" when the input cannot be parsed.
 *
 * Handles:
 *  - Google Sheets Date objects (time part extracted)
 *  - "HH:mm" / "H:mm" / "HH.mm" / "H.mm"
 *  - "8am" / "8 AM" / "8:30pm" / "8:30 PM"
 *  - Bare integers / strings like "8" or "9" (assumed AM in hospitality ctx)
 *  - Angel Court quirk: values 18-23 are almost always 06-11 entered in 24-hr
 *    when the form expected 12-hr (e.g. "20:30" → "08:30")
 *
 * @param  {*}      raw   Any value from a sheet cell, subject line, or filename.
 * @return {string}       "HH:mm" or "".
 */
function parseHospitalityTime_(raw) {
  if (raw === null || raw === undefined || raw === "") return "";

  // ── Google Sheets Date object ──────────────────────────────────────────────
  if (Object.prototype.toString.call(raw) === "[object Date]" && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), "HH:mm");
  }

  let t = String(raw).trim().toLowerCase();
  if (!t) return "";

  // ── "HH:mm:ss" / "HH:mm" / "H:mm" ────────────────────────────────────────
  let m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(am|pm))?$/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2];
    const meridian = m[3] || "";

    hh = applyMeridian_(hh, meridian);
    hh = collapseHospitalityHour_(hh);
    return pad2_(hh) + ":" + mm;
  }

  // ── "H.mm" / "HH.mm" (dotted, no meridian) ────────────────────────────────
  m = t.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2];
    hh = collapseHospitalityHour_(hh);
    return pad2_(hh) + ":" + mm;
  }

  // ── "8am" / "8 AM" / "8:30pm" embedded in longer text ────────────────────
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2] || "00";
    const meridian = m[3];

    hh = applyMeridian_(hh, meridian);
    hh = collapseHospitalityHour_(hh);
    return pad2_(hh) + ":" + mm;
  }

  // ── Bare integer hour string "8" / "9" ────────────────────────────────────
  m = t.match(/^(\d{1,2})$/);
  if (m) {
    let hh = Number(m[1]);
    hh = collapseHospitalityHour_(hh);
    return pad2_(hh) + ":00";
  }

  // ── Colon-separated from longer text (no meridian) e.g. "at 08:30" ────────
  m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2];
    hh = collapseHospitalityHour_(hh);
    return pad2_(hh) + ":" + mm;
  }

  return "";
}

/**
 * Apply am/pm meridian to a raw hour value.
 * @param  {number} hh       0-23
 * @param  {string} meridian "am" | "pm" | ""
 * @return {number}
 */
function applyMeridian_(hh, meridian) {
  if (!meridian) return hh;
  if (meridian === "pm" && hh !== 12) return hh + 12;
  if (meridian === "am" && hh === 12) return 0;
  return hh;
}

/**
 * Angel Court sanity check: the booking form is nominally 12-hr but values
 * are sometimes entered in 24-hr (20:00 meaning 08:00 AM, 23:30 → 11:30 AM).
 * Hours 18-23 are collapsed back to 06-11.
 * @param  {number} hh
 * @return {number}
 */
function collapseHospitalityHour_(hh) {
  return hh;
}

// ---------------------------------------------------------------------------
// BACKWARDS-COMPATIBLE ALIASES
// Any existing call sites for normaliseHospitalityTime_ continue to work.
// ---------------------------------------------------------------------------

/**
 * Alias for parseHospitalityTime_().
 * Kept so existing call sites (parseAngelCourtBookingSheet_, GmailScanner,
 * TestHarness) require no changes.
 */
function normaliseHospitalityTime_(raw) {
  return parseHospitalityTime_(raw);
}

/**
 * Alias for parseHospitalityTime_().
 * Replaces the old normaliseTimeText_() which only handled Date objects,
 * "H:mm", "H.mm", and bare am/pm — a strict subset of parseHospitalityTime_.
 */
function normaliseTimeText_(raw) {
  return parseHospitalityTime_(raw);
}


// ---------------------------------------------------------------------------
// CANONICAL DATE PARSER
// ---------------------------------------------------------------------------

/**
 * Parses any date representation found in Angel Court booking forms and
 * returns a "yyyy-MM-dd" ISO date string, or "" on failure.
 *
 * Handles:
 *  - Google Sheets Date objects
 *  - "dd.mm.yy" / "dd.mm.yyyy" / "d.m.yy"
 *  - "dd/mm/yy" / "dd/mm/yyyy" / "dd-mm-yyyy"
 *  - "dd MMM yyyy" / "d MMMM yyyy"  (e.g. "14 July 2026")
 *  - ISO "yyyy-MM-dd" pass-through
 *
 * @param  {*}      raw   Sheet cell value, string, or Date object.
 * @return {string}       "yyyy-MM-dd" or "".
 */
function parseHospitalityDate_(raw) {
  if (!raw) return "";

  // ── Google Sheets Date object ──────────────────────────────────────────────
  if (Object.prototype.toString.call(raw) === "[object Date]" && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const text = String(raw)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";

  const dateText = text.replace(
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i,
    ""
  ).trim();

  const withoutWeekday = text.replace(
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i,
    ""
  );

  let m;

  m = dateText.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{2,4})$/i);

  // ── ISO pass-through "yyyy-MM-dd" ─────────────────────────────────────────
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return text; // already normalised

  // ── "dd.mm.yy" / "dd.mm.yyyy" / "d.m" ────────────────────────────────────
  m = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (m) {
    const d = parseComponents_(m[1], m[2], m[3]);
    if (d) return formatIsoDate_(d);
  }

  // ── "dd/mm/yy" / "dd/mm/yyyy" / "dd-mm-yyyy" ──────────────────────────────
  m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = parseComponents_(m[1], m[2], m[3]);
    if (d) return formatIsoDate_(d);
  }

  m = withoutWeekday.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{2,4})$/i); // ── "dd MMM yyyy" / "d MMMM yyyy" ────────────────────────────────────────

  // ── "14 July 2026" / "14 Jul 2026" / "14th July 2026" ────────────────────
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{2,4})$/i);
  if (m) {
    const monthNum = MONTHS[m[2].toLowerCase()];
    if (monthNum) {
      const d = parseComponents_(m[1], String(monthNum), m[3]);
      if (d) return formatIsoDate_(d);
    }
  }

  return "";
}

/**
 * Build a Date from string day/month/year components (all as strings).
 * Returns null if the resulting date is invalid.
 */
function parseComponents_(dayStr, monthStr, yearStr) {
  const dd = parseInt(dayStr, 10);
  const mm = parseInt(monthStr, 10);
  let yyyy = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
  if (yyyy < 100) yyyy += 2000;

  if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return null;

  const d = new Date(yyyy, mm - 1, dd);

  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd
  ) {
    return null;
  }

  return d;
}

/** Format a Date as "yyyy-MM-dd". */
function formatIsoDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// BACKWARDS-COMPATIBLE DATE ALIASES
// ---------------------------------------------------------------------------

/**
 * Alias — delegates to parseHospitalityDate_().
 */
function parseDateToIsoDate_(raw) {
  return parseHospitalityDate_(raw);
}

/**
 * Alias — kept so TestHarness and any external call sites don't break.
 * Returns a Date object (same contract as before), or null.
 */
function parseFlexibleDateTime_(raw) {
  if (!raw) return null;
  if (Object.prototype.toString.call(raw) === "[object Date]" && !isNaN(raw.getTime())) {
    return raw;
  }
  const iso = parseHospitalityDate_(raw);
  if (!iso) return null;
  const parts = iso.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}


// ---------------------------------------------------------------------------
// EXTRACT TIME FROM FREE TEXT / FILENAMES
// ---------------------------------------------------------------------------

/**
 * Finds the first time expression anywhere in a free-text string
 * (email subject, attachment filename, sheet name, etc.).
 *
 * Returns "HH:mm" or "".
 */
function extractTimeFromText_(text) {
  if (!text) return "";
  const s = String(text);

  // Prefer explicit meridian forms first ("8:30pm", "8am") as they are
  // unambiguous, then fall back to bare colon/dot times.
  let m;

  // "08:00pm" / "8:30 AM"
  m = s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (m) return parseHospitalityTime_(m[0]);

  // "8am" / "8 PM"
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (m) return parseHospitalityTime_(m[0]);

  // "08:30" / "8:30"
  m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return parseHospitalityTime_(m[0]);

  return "";
}

/**
 * Finds a time expression in a sheet tab name.
 * Identical contract to extractTimeFromText_ — kept as a named alias
 * because it is referenced in parseAngelCourtLineItems_.
 */
function extractTimeFromSheetName_(name) {
  return extractTimeFromText_(name);
}


// ---------------------------------------------------------------------------
// BOOKING TIME NORMALISATION  (called after parse, before validate)
// ---------------------------------------------------------------------------

/**
 * Normalises all time fields in a booking object using parseHospitalityTime_.
 *
 * Also ensures every line item has a time value, falling back through:
 *   1. The item's own parsed time
 *   2. The last non-empty time seen while iterating items (forward fill)
 *   3. The first booking-level serviceTime
 *
 * This prevents quote generation and calendar creation from failing when
 * a customer leaves the time column blank on individual line items.
 */
function normaliseBookingTimes_(booking) {
  // Normalise booking-level service times
  booking.serviceTimes = (booking.serviceTimes || [])
    .map(parseHospitalityTime_)
    .filter(Boolean);

  const bookingDefaultTime =
    booking.serviceTimes.length ? booking.serviceTimes[0] : "";

  let lastKnownTime = bookingDefaultTime;

  booking.items = (booking.items || []).map(item => {
    if (item.time) {
      const parsed = parseHospitalityTime_(item.time);
      item.time = parsed || lastKnownTime || bookingDefaultTime;
    } else {
      item.time = lastKnownTime || bookingDefaultTime;
    }

    if (item.time) lastKnownTime = item.time;

    return item;
  });

  return booking;
}


// ---------------------------------------------------------------------------
// MAIN BOOKING BUILDERS
// ---------------------------------------------------------------------------

function buildBookingFromMessageId(messageId) {
  const msg = GmailApp.getMessageById(messageId);
  const thread = msg.getThread();
  const atts = msg.getAttachments({ includeInlineImages: false });

  const xlsx = atts.find(att => isXlsx_(att));
  if (!xlsx) throw new Error("No XLSX attachment found.");

  let tempSheetId = null;

  try {
    tempSheetId = convertXlsxToGoogleSheet_(xlsx);

    const ss = SpreadsheetApp.openById(tempSheetId);
    const sheet = ss.getSheets()[0];

    let booking = parseAngelCourtBookingSheet_(sheet);

    if (!booking.serviceTimes || booking.serviceTimes.length === 0) {
      const fallbackTime =
        extractTimeFromText_(msg.getSubject()) ||
        extractTimeFromText_(xlsx.getName()) ||
        extractTimeFromText_(sheet.getName());

      if (fallbackTime) {
        booking.serviceTimes = [fallbackTime];
        booking.items = booking.items.map(item => {
          if (!item.time) item.time = fallbackTime;
          return item;
        });
      }
    }

    booking.bookingId = generateBookingId_();
    booking.messageId = msg.getId();
    booking.threadId = thread.getId();
    booking.attachmentName = xlsx.getName();
    booking.emailReceived = msg.getDate();
    booking.sourceEmailFrom = msg.getFrom();
    booking.sourceEmailSubject = msg.getSubject();

    booking.hostEmail = extractEmailAddress_(msg.getFrom());
    if (!booking.hostName) booking.hostName = extractEmailName_(msg.getFrom());

    booking = normaliseBookingTimes_(booking);
    booking = validateBooking_(booking);

    return booking;

  } finally {
    if (tempSheetId) {
      try { DriveApp.getFileById(tempSheetId).setTrashed(true); } catch (e) { }
    }
  }
}


// ---------------------------------------------------------------------------
// SHEET PARSER
// ---------------------------------------------------------------------------

function parseAngelCourtBookingSheet_(sheet) {
  let booking = createEmptyBooking_();

  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();

  const notes =
    getNotesBlockUnderLabel_(sheet, "Allergens & Dietary Requirements") ||
    getNotesBlockUnderLabel_(sheet, "NOTES:") ||
    getNotesBlockUnderLabel_(sheet, "Notes & dietary/allergen information") ||
    "";

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findValueRightOfLabel(labelText) {
    const target = norm(labelText);
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        if (norm(values[r][c]) === target) {
          for (let offset = 1; offset <= 4; offset++) {
            const v = values[r][c + offset];
            if (isFormLabel_(v)) return "";
            if (v !== "" && v !== null && v !== undefined) return v;
          }
          return "";
        }
      }
    }
    return "";
  }

  function findDisplayRightOfLabel(labelText) {
    const target = norm(labelText);
    for (let r = 0; r < displayValues.length; r++) {
      for (let c = 0; c < displayValues[r].length; c++) {
        if (norm(displayValues[r][c]) === target) {
          for (let offset = 1; offset <= 4; offset++) {
            const v = displayValues[r][c + offset];
            if (isFormLabel_(v)) return "";
            if (v !== "" && v !== null && v !== undefined) return String(v).trim();
          }
          return "";
        }
      }
    }
    return "";
  }

  const company = findValueRightOfLabel("Company Name:") || findValueRightOfLabel("Company name:");
  const pax = findValueRightOfLabel("Total Number of people:") || findValueRightOfLabel("Number of guests:");
  const floorRaw = findValueRightOfLabel("Floor Level") || findValueRightOfLabel("Floor level:");
  const hostName = findValueRightOfLabel("Name:") || findValueRightOfLabel("Contact name:");
  const hostEmail = findValueRightOfLabel("Email:") || findValueRightOfLabel("Contact email:");

  const dateRaw =
    findValueRightOfLabel("Date of event:") ||
    findDisplayRightOfLabel("Date of event:") ||
    findValueRightOfLabel("Date of delivery (DD/MM/YY):") ||
    findDisplayRightOfLabel("Date of delivery (DD/MM/YY):");

  const items = parseAngelCourtLineItems_(sheet);

  // Deduplicate service times from line items
  const serviceTimes = [...new Set(items.map(i => i.time).filter(Boolean))];

  let eventDate = parseHospitalityDate_(dateRaw);

  if (!eventDate) {
    const fallbackDate = extractDateFromSheetName_(sheet.getName());
    if (fallbackDate) eventDate = formatIsoDate_(fallbackDate);
  }

  const serviceTypes = [...new Set(
    items.map(i => i.section).filter(Boolean).map(s => String(s).trim())
  )];

  const totalPrice = findCurrencyValueByLabel_(sheet, "Grand Net Total");
  const mgmtFee = totalPrice * 0.08;
  const netPrice = totalPrice + mgmtFee;
  const vat = netPrice * 0.20;
  const grossPrice = netPrice + vat;

  booking.clientCompany = String(company || "").trim();
  booking.hostName = String(hostName || "").trim();
  booking.hostEmail = String(hostEmail || "").trim();
  booking.pax = pax || "";
  booking.eventDate = eventDate || "";
  booking.serviceType = serviceTypes.length ? serviceTypes.join(" / ") : "";
  booking.location = "One Angel Court";
  booking.floor = cleanFloor_(floorRaw);
  booking.notes = notes;

  booking.totalPrice = roundMoney_(totalPrice);
  booking.mgmtFee = roundMoney_(mgmtFee);
  booking.netPrice = roundMoney_(netPrice);
  booking.vat = roundMoney_(vat);
  booking.grossPrice = roundMoney_(grossPrice);

  // Normalise booking-level times
  booking.serviceTimes = serviceTimes
    .map(parseHospitalityTime_)
    .filter(Boolean)
    .slice(0, 1);

  const bookingDefaultTime =
    booking.serviceTimes.length ? booking.serviceTimes[0] : "";

  // Forward-fill item times: if a customer left the time blank on a row,
  // carry the last known time forward so quote/calendar never get an empty time.
  let lastKnownTime = bookingDefaultTime;

  booking.items = items.map(item => {
    if (item.time) {
      const parsed = parseHospitalityTime_(item.time);
      item.time = parsed || lastKnownTime || bookingDefaultTime;
    } else {
      item.time = lastKnownTime || bookingDefaultTime;
    }
    if (item.time) lastKnownTime = item.time;
    return item;
  });

  return booking;
}


// ---------------------------------------------------------------------------
// LINE ITEM PARSER
// ---------------------------------------------------------------------------

function parseAngelCourtLineItems_(sheet) {
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  let headerRow = -1;
  let cols = { item: -1, info: -1, qty: -1, time: -1, comment: -1 };

  for (let r = 0; r < values.length; r++) {
    const row = displayValues[r].map(norm);

    const itemCol = row.findIndex(v => v === "item" || v.includes("item"));
    const qtyCol = row.findIndex(v =>
      v.includes("number required") ||
      v.includes("number") ||
      v.includes("qty") ||
      v.includes("quantity") ||
      v.includes("amount required")
    );

    if (itemCol !== -1 && qtyCol !== -1 && itemCol < qtyCol) {
      headerRow = r;
      cols.item = itemCol;
      cols.qty = qtyCol;
      cols.info = row.indexOf("info");
      cols.time = row.findIndex(v =>
        v.includes("time required") ||
        v.includes("service time") ||
        v === "time"
      );
      cols.comment = row.findIndex(v =>
        v.includes("comment") || v.includes("notes")
      );
      break;
    }
  }

  if (headerRow === -1) return [];

  const fallbackTime = extractTimeFromSheetName_(sheet.getName());

  const items = [];
  let currentSection = "";

  for (let r = headerRow + 1; r < values.length; r++) {
    const itemRaw = cols.item >= 0 ? values[r][cols.item] : "";
    const infoRaw = cols.info >= 0 ? values[r][cols.info] : "";
    const qtyRaw = cols.qty >= 0 ? values[r][cols.qty] : "";
    const timeRaw = cols.time >= 0 ? displayValues[r][cols.time] : "";
    const commentRaw = cols.comment >= 0 ? values[r][cols.comment] : "";

    const hasAny =
      (itemRaw !== "" && itemRaw !== null) ||
      (infoRaw !== "" && infoRaw !== null) ||
      (qtyRaw !== "" && qtyRaw !== null) ||
      (commentRaw !== "" && commentRaw !== null);

    if (!hasAny) continue;

    const itemText = String(itemRaw || "").trim();
    const infoText = String(infoRaw || "").trim();
    const commentText = String(commentRaw || "").trim();
    const qtyNum = parseRequiredQty_(qtyRaw);

    const lowerItem = itemText.toLowerCase();

    const isFooterRow =
      lowerItem.startsWith("please note") ||
      lowerItem.includes("all quotes are subject") ||
      lowerItem.includes("quotes are subject") ||
      lowerItem.includes("notice & cancellation policy") ||
      lowerItem.includes("grand net total");

    if (isFooterRow) {
      break;
    }

    const isSection =
      itemText &&
      !infoText &&
      !commentText &&
      (!qtyNum || qtyNum <= 0) &&
      isLikelySectionHeading_(itemText);

    if (isSection) {
      currentSection = itemText;
      continue;
    }

    if (!qtyNum || qtyNum <= 0) continue;

    const timeText =
      parseHospitalityTime_(timeRaw) ||
      parseHospitalityTime_(fallbackTime) ||
      "";

    const split = splitOrderNameAndDetail_(itemText);

    items.push({
      section: currentSection,
      time: timeText,
      name: split.name,
      detail: split.detail,
      info: infoText,
      qty: qtyNum % 1 === 0 ? String(qtyNum.toFixed(0)) : String(qtyNum),
      comment: commentText
    });
  }

  Logger.log("ITEM COUNT = " + items.length);
  if (items.length) Logger.log("FIRST ITEM = " + JSON.stringify(items[0]));

  return items;
}

function isLikelySectionHeading_(text) {
  const s = String(text || "").trim();
  const lower = s.toLowerCase();

  if (!s) return false;

  const knownSections = [
    "breakfast",
    "lunch",
    "lunch add-on",
    "events catering",
    "add-ons",
    "summer bbq catering",
    "alcoholic drinks - white wine",
    "alcoholic drinks - red wine",
    "alcoholic drinks - rose wine",
    "alcoholic drinks - sparkling wine",
    "drinks & drinks packages"
  ];

  if (knownSections.includes(lower)) return true;

  // Avoid treating long menu descriptions as section headings.
  if (s.length > 70) return false;

  // Avoid anything that looks like a product description.
  if (
    lower.includes("minimum") ||
    lower.includes("serves") ||
    lower.includes("please") ||
    lower.includes("wrapped") ||
    lower.includes("served with")
  ) {
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------------------

function extractDateFromSheetName_(name) {
  const text = String(name || "");
  const m = text.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (!m) return null;

  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yyyy = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (yyyy < 100) yyyy += 2000;

  const d = new Date(yyyy, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
}


// ---------------------------------------------------------------------------
// MISC UTILITIES
// ---------------------------------------------------------------------------

function isXlsx_(attachment) {
  const name = String(attachment.getName() || "").toLowerCase();
  const ct = String(attachment.getContentType() || "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    ct === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function extractEmailAddress_(fromText) {
  const text = String(fromText || "");
  let m = text.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].trim() : "";
}

function extractEmailName_(fromText) {
  const text = String(fromText || "").trim();
  let m = text.match(/^(.+?)\s*<.+>$/);
  if (m) return m[1].replace(/["']/g, "").trim();
  m = text.match(/^([^@]+)@/);
  if (m) {
    return m[1]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, s => s.toUpperCase())
      .trim();
  }
  return text;
}

function parseRequiredQty_(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number") return value > 0 ? value : null;

  const text = String(value).trim();
  if (!text) return null;

  const match = text.match(/\d+(\.\d+)?/);
  if (!match) return null;

  const n = Number(match[0]);
  return n > 0 ? n : null;
}

function cleanFloor_(value) {
  return String(value || "").trim().replace(/^floor\s+/i, "").trim();
}

function roundMoney_(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function findCurrencyValueByLabel_(sheet, labelText) {
  const values = sheet.getDataRange().getValues();
  const displays = sheet.getDataRange().getDisplayValues();

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  const target = norm(labelText);

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (norm(values[r][c]) === target || norm(displays[r][c]) === target) {
        for (let offset = 1; offset <= 6; offset++) {
          const raw = values[r][c + offset];
          const display = displays[r][c + offset];

          if (typeof raw === "number" && isFinite(raw)) return raw;

          const cleaned = String(display || "").replace(/[£,]/g, "").trim();
          const n = parseFloat(cleaned);
          if (isFinite(n)) return n;
        }
      }
    }
  }
  return 0;
}

function getNotesBlockUnderLabel_(sheet, labelText) {
  const values = sheet.getDataRange().getDisplayValues();

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  const target = norm(labelText);
  let labelRow = -1;

  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (norm(values[r][c]) === target) { labelRow = r; break; }
    }
    if (labelRow !== -1) break;
  }

  if (labelRow === -1) return "";

  const lines = [];
  let blankRun = 0;

  for (let r = labelRow + 1; r < Math.min(values.length, labelRow + 31); r++) {
    const rowTexts = values[r]
      .map(c => String(c || "").trim())
      .filter(Boolean);

    if (rowTexts.length === 0) {
      blankRun++;
      if (blankRun >= 8 && lines.length > 0) break;
      continue;
    }
    blankRun = 0;

    const joined = rowTexts.join(" ").replace(/\s+/g, " ").trim();
    const lower = joined.toLowerCase();

    if (
      lower.includes("notice") ||
      lower.includes("cancellation") ||
      lower.includes("grand net total") ||
      lower.includes("please note that all quotes")
    ) break;

    if (norm(joined) === target) continue;
    lines.push(joined);
  }

  const cleaned = [];
  for (const line of lines) {
    if (!cleaned.length || cleaned[cleaned.length - 1] !== line) cleaned.push(line);
  }
  return cleaned.join("\n");
}

function pad2_(n) {
  return String(n).padStart(2, "0");
}

function splitOrderNameAndDetail_(text) {
  const s = String(text || "").trim();
  const parts = s.split(/\s+-\s+/);
  if (parts.length <= 1) return { name: s, detail: "" };
  return { name: parts.shift().trim(), detail: parts.join(" - ").trim() };
}

function isFormLabel_(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.endsWith(":") ||
    [
      "company", "company name:", "name:", "email:",
      "host name", "host email", "date of event:", "event date",
      "total number of people:", "pax", "service time", "service type",
      "location", "floor", "floor level"
    ].includes(text)
  );
}

function isAngelCourtBookingForm_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function hasText(text) {
    const target = norm(text);
    return values.some(row => row.some(cell => norm(cell) === target));
  }

  let hasItemHeader = false;
  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(norm);
    if (row.includes("item") && row.some(v => v.includes("number required"))) {
      hasItemHeader = true;
      break;
    }
  }

  return (
    hasItemHeader &&
    hasText("Company Name:") &&
    hasText("Date of event:") &&
    hasText("Total Number of people:") &&
    hasText("Grand Net Total")
  );
}

function debugDashboardCount() {
  const bookings = getDashboardBookings();
  Logger.log("Bookings found: " + bookings.length);
  Logger.log(JSON.stringify(bookings.map(b => b.BookingID)));
}