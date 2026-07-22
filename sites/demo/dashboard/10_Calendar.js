function createCalendarEventForRow(rowNumber, options) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");
  const hasExistingCalendar = !!(booking.calendarEventId || booking.calendarEventUrl);
  const calendarIsStale = booking.calendarStale === true || booking.calendarStale === "TRUE";
  const isStaleRegeneration = hasExistingCalendar && calendarIsStale;
  if (hasExistingCalendar && !calendarIsStale) {
    throw new Error("Calendar event already exists for this booking.");
  }
  if (
    getConfiguredValue_("REQUIRE_QUOTE_BEFORE_CALENDAR", true) &&
    !booking.quoteUrl
  ) {
    throw new Error("Generate quote before creating calendar event.");
  }
  if (!booking.eventDate) throw new Error("Missing event date.");
  if (!booking.serviceTimes || booking.serviceTimes.length === 0) {
    throw new Error("Missing service time.");
  }

  const quoteFileId = extractDriveIdFromUrl_(booking.quoteUrl);
  if (!quoteFileId) throw new Error("Could not read quote file ID.");

  const quoteFile = DriveApp.getFileById(quoteFileId);
  const sourceBookingFile = getOptionalSourceBookingFile_(booking);
  const bookingJsonFile = getOrCreateBookingJsonFile_(booking);
  booking.bookingJsonFileId = bookingJsonFile.getId();
  booking.bookingJsonFileUrl = bookingJsonFile.getUrl();
  updateBookingJsonFile_(bookingJsonFile, booking);
  writeBookingObjectToExistingRow_(rowNumber, booking);

  const attendeeConfig = getCalendarAttendeeConfig_();
  const attendees = selectCalendarAttendees_(attendeeConfig, options);
  const calendarId = String(
    getConfiguredValue_("CALENDAR_ID", CONFIG.CALENDAR_ID || "primary")
  ).trim();
  const eventDuration = Number(
    getConfiguredNumber_(
      "CALENDAR_EVENT_DURATION_MINUTES",
      CONFIG.CALENDAR_EVENT_DURATION_MINUTES || 60
    )
  );
  const startOffsetMinutes = Number(
    getConfiguredNumber_(
      "CALENDAR_EVENT_START_OFFSET_MINUTES",
      CONFIG.CALENDAR_EVENT_START_OFFSET_MINUTES || 0
    )
  );
  const eventColorId = normaliseCalendarColorId_(
    getConfiguredValue_(
      "CALENDAR_EVENT_COLOR_ID",
      CONFIG.CALENDAR_EVENT_COLOR_ID || "9"
    )
  );

  if (!calendarId) throw new Error("Calendar ID is blank in Settings.");
  if (!isFinite(eventDuration) || eventDuration < 1) {
    throw new Error("Calendar event duration must be at least 1 minute.");
  }
  if (!isFinite(startOffsetMinutes)) {
    throw new Error("Calendar event start offset must be a number of minutes.");
  }
  if (attendeeConfig.invalid.length) {
    throw new Error(
      "Invalid calendar attendee email address" +
      (attendeeConfig.invalid.length > 1 ? "es" : "") +
      ": " +
      attendeeConfig.invalid.join(", ")
    );
  }

  if (isStaleRegeneration && booking.calendarEventId) {
    try {
      Calendar.Events.remove(calendarId, booking.calendarEventId, { sendUpdates: "all" });
    } catch (error) {
      console.warn("Could not remove stale calendar event " + booking.calendarEventId + ": " +
        (error && error.message ? error.message : String(error)));
    }
    booking.calendarEventId = "";
    booking.calendarEventUrl = "";
    booking.calendarCreatedAt = "";
  }

  const siteName = getConfiguredValue_("LOCATION_NAME", CONFIG.LOCATION_NAME || "FIKA Hospitality");

  const serviceStart = buildCalendarStart_(booking.eventDate, booking.serviceTimes[0]);
  const start = applyCalendarStartOffset_(serviceStart, startOffsetMinutes);
  const end = new Date(start.getTime() + eventDuration * 60 * 1000);

  const warnForLateAmendment = shouldWarnForStaleCalendarRegeneration_(isStaleRegeneration, serviceStart, new Date());
  const title = makeCalendarEventTitle_(booking, warnForLateAmendment);
  const description = makeCalendarEventDescription_(booking.notes, warnForLateAmendment);

  const eventResource = {
    summary: title,
    location: `${booking.location || siteName} ${booking.floor || ""}`.trim(),
    description: description,
    start: {
      dateTime: start.toISOString(),
      timeZone: Session.getScriptTimeZone()
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: Session.getScriptTimeZone()
    }
  };

  if (eventColorId) eventResource.colorId = eventColorId;
  if (attendees.length) eventResource.attendees = attendees;

  const attachments = [
      {
        fileUrl: quoteFile.getUrl(),
        title: quoteFile.getName(),
        mimeType: quoteFile.getMimeType()
      },
      {
        fileUrl: bookingJsonFile.getUrl(),
        title: bookingJsonFile.getName(),
        mimeType: bookingJsonFile.getMimeType()
      }
    ].concat(sourceBookingFile ? [{
      fileUrl: sourceBookingFile.getUrl(),
      title: sourceBookingFile.getName(),
      mimeType: sourceBookingFile.getMimeType()
    }] : []);

  if (attachments.length) eventResource.attachments = attachments;

  let created;
  try {
    created = Calendar.Events.insert(
      eventResource,
      calendarId,
      {
        supportsAttachments: attachments.length > 0,
        sendUpdates: "all"
      }
    );
  } catch (error) {
    const diagnostic = buildCalendarDiagnostic_(eventResource, calendarId);
    console.error("Calendar insert failed", JSON.stringify({
      error: error && error.message ? error.message : String(error),
      diagnostic: diagnostic
    }));
    throw new Error(
      "Calendar rejected the event. " +
      diagnostic +
      " Original error: " +
      (error && error.message ? error.message : String(error))
    );
  }

  if (sourceBookingFile) {
    booking.originalBookingFileId = sourceBookingFile.getId();
    booking.originalBookingFileUrl = sourceBookingFile.getUrl();
  }
  booking.calendarEventId = created.id || "";
  booking.calendarEventUrl = created.htmlLink || "";
  booking.calendarCreatedAt = new Date();
  booking.status = CONFIG.STATUS.CPU_CREATED;
  booking.updatedAt = new Date();
  booking.calendarStale = false;

  writeBookingObjectToExistingRow_(rowNumber, booking);
  updateBookingJsonFile_(bookingJsonFile, booking);

  return { ok: true, eventUrl: created.htmlLink || "" };
}

function getCalendarAttendeeOptions() {
  const attendeeConfig = getCalendarAttendeeConfig_();
  return {
    ok: true,
    attendees: attendeeConfig.valid.map(function(attendee) {
      return {
        email: attendee.email,
        label: makeCalendarAttendeeLabel_(attendee.email),
        selected: true
      };
    }),
    invalid: attendeeConfig.invalid
  };
}

function getOrCreateBookingJsonFile_(booking) {
  let file = null;

  if (booking.bookingJsonFileId) {
    try {
      file = DriveApp.getFileById(booking.bookingJsonFileId);
    } catch (error) {
      file = null;
    }
  }

  if (!file && booking.bookingJsonFileUrl) {
    const id = extractDriveIdFromUrl_(booking.bookingJsonFileUrl);
    if (id) {
      try {
        file = DriveApp.getFileById(id);
      } catch (error) {
        file = null;
      }
    }
  }

  if (!file) {
    const folder = getQuoteFolderForBooking_(booking);
    const fileName = makeBookingJsonFileName_(booking);
    const blob = Utilities.newBlob(
      serialiseBookingJson_(booking),
      "application/json",
      fileName
    );
    file = folder.createFile(blob);
  } else {
    updateBookingJsonFile_(file, booking);
  }

  return file;
}

function updateBookingJsonFile_(file, booking) {
  file.setName(makeBookingJsonFileName_(booking));
  file.setContent(serialiseBookingJson_(booking));
  return file;
}

function makeBookingJsonFileName_(booking) {
  const id = String(booking.bookingId || "booking")
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return "Booking Object - " + id + ".json";
}

function serialiseBookingJson_(booking) {
  return JSON.stringify(booking, null, 2);
}

function getOrCreateOriginalBookingXlsxFile_(booking) {
  if (booking.originalBookingFileId) {
    try {
      return DriveApp.getFileById(booking.originalBookingFileId);
    } catch (e) {
      // File was deleted/moved or ID is invalid, so recreate it below.
    }
  }

  if (booking.originalBookingFileUrl) {
    const existingId = extractDriveIdFromUrl_(booking.originalBookingFileUrl);
    if (existingId) {
      try {
        return DriveApp.getFileById(existingId);
      } catch (e) {
        // File was deleted/moved or URL is invalid, so recreate it below.
      }
    }
  }

  return saveOriginalBookingXlsxToDrive_(booking);
}

function saveOriginalBookingXlsxToDrive_(booking) {
  const msg = GmailApp.getMessageById(booking.messageId);
  const atts = msg.getAttachments({ includeInlineImages: false });

  let chosen = null;

  for (const att of atts) {
    if (!isXlsx_(att)) continue;

    if (booking.attachmentName && att.getName() === booking.attachmentName) {
      chosen = att;
      break;
    }

    if (!chosen) chosen = att;
  }

  if (!chosen) throw new Error("Could not find original XLSX attachment.");

  const folder = getQuoteFolderForBooking_(booking);
  const fileName =
    `Original Booking Form - ${booking.clientCompany || "Unknown"} - ${booking.eventDate || ""}.xlsx`;

  return folder.createFile(chosen.copyBlob()).setName(fileName);
}

function getCalendarAttendeeConfig_() {
  const raw = String(
    getConfiguredValue_(
      "CALENDAR_ATTENDEES",
      (CONFIG.CALENDAR_ATTENDEES || []).join(", ")
    )
  );

  return parseCalendarAttendees_(raw);
}

function parseCalendarAttendees_(raw) {
  const emails = String(raw || "")
    .split(/[\s,;]+/)
    .map(email => email.trim())
    .filter(Boolean);

  const valid = [];
  const invalid = [];
  const seen = {};

  emails.forEach(email => {
    const lower = email.toLowerCase();
    if (seen[lower]) return;
    seen[lower] = true;

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      valid.push({ email: email });
    } else {
      invalid.push(email);
    }
  });

  return { valid: valid, invalid: invalid };
}

function getCalendarAttendeesFromSettings_() {
  return getCalendarAttendeeConfig_().valid;
}

function selectCalendarAttendees_(attendeeConfig, options) {
  if (!options || !Array.isArray(options.attendeeEmails)) {
    return attendeeConfig.valid;
  }

  const requested = parseCalendarAttendees_(options.attendeeEmails.join(", "));
  if (requested.invalid.length) {
    throw new Error(
      "Invalid selected calendar attendee email address" +
      (requested.invalid.length > 1 ? "es" : "") +
      ": " +
      requested.invalid.join(", ")
    );
  }

  const allowed = {};
  attendeeConfig.valid.forEach(function(attendee) {
    allowed[String(attendee.email || "").toLowerCase()] = attendee;
  });

  const unknown = [];
  const selected = [];

  requested.valid.forEach(function(attendee) {
    const key = String(attendee.email || "").toLowerCase();
    if (!allowed[key]) {
      unknown.push(attendee.email);
      return;
    }
    selected.push(allowed[key]);
  });

  if (unknown.length) {
    throw new Error("Selected calendar attendee is not configured in Settings: " + unknown.join(", "));
  }

  return selected;
}

function makeCalendarAttendeeLabel_(email) {
  const local = String(email || "").split("@")[0] || "";
  const known = {
    demo: "FIKA",
    manager: "Manager",
    operations: "Operations"
  };
  const lower = local.toLowerCase();
  if (known[lower]) return known[lower];

  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ") || email;
}

function normaliseCalendarColorId_(value) {
  const colorId = String(value === null || value === undefined ? "" : value).trim();
  if (!colorId) return "";
  return /^(?:[1-9]|1[01])$/.test(colorId) ? colorId : "";
}

function buildCalendarDiagnostic_(resource, calendarId) {
  const start = resource.start && resource.start.dateTime
    ? resource.start.dateTime
    : "missing";
  const end = resource.end && resource.end.dateTime
    ? resource.end.dateTime
    : "missing";
  const attendeeCount = Array.isArray(resource.attendees)
    ? resource.attendees.length
    : 0;
  const attachmentCount = Array.isArray(resource.attachments)
    ? resource.attachments.length
    : 0;

  return [
    "Calendar: " + calendarId + ".",
    "Start: " + start + ".",
    "End: " + end + ".",
    "Attendees: " + attendeeCount + ".",
    "Attachments: " + attachmentCount + ".",
    "Colour: " + (resource.colorId || "default") + "."
  ].join(" ");
}

function makeCalendarTitle_(booking) {
  const locationShortCode =
    getConfiguredValue_("LOCATION_SHORT_CODE", CONFIG.LOCATION_SHORT_CODE || "DEMO");
  const company = booking.clientCompany || "Unknown Company";
  const service = booking.serviceType || "Hospitality";
  const pax = booking.pax || "";

  return `${locationShortCode}_${company}_${service} x ${pax}`;
}

const STALE_CALENDAR_WARNING_NOTE =
  "WARNING this booking time/date was amended and is now within 72 hours of the service start time.";

function shouldWarnForStaleCalendarRegeneration_(isStaleRegeneration, start, now) {
  if (!isStaleRegeneration || !(start instanceof Date) || isNaN(start.getTime())) return false;
  const current = now instanceof Date ? now : new Date();
  const millisecondsUntilStart = start.getTime() - current.getTime();
  return millisecondsUntilStart >= 0 && millisecondsUntilStart < 72 * 60 * 60 * 1000;
}

function makeCalendarEventTitle_(booking, includeWarning) {
  return (includeWarning ? "WARNING " : "") + makeCalendarTitle_(booking);
}

function makeCalendarEventDescription_(notes, includeWarning) {
  const bookingNotes = String(notes || "").trim();
  const description = includeWarning
    ? STALE_CALENDAR_WARNING_NOTE + (bookingNotes ? "\n\n" + bookingNotes : "")
    : bookingNotes;
  return description.slice(0, 8000);
}

/**
 * Builds a local Date for the calendar event start.
 *
 * timeText is passed through parseHospitalityTime_() so the calendar can
 * handle any format that survived into booking.serviceTimes — e.g. a value
 * manually edited in the dashboard, a bare "8" entered on the form, or a
 * stale "20:30" that slipped past the normaliser.  Falls back to midnight
 * (00:00) if the time cannot be parsed, so calendar creation never throws
 * an error for a bad time string.
 *
 * @param  {string} isoDate   "yyyy-MM-dd"
 * @param  {string} timeText  Any time string or already-normalised "HH:mm"
 * @return {Date}
 */
function buildCalendarStart_(isoDate, timeText) {
  const dateText = String(isoDate || "").trim();
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error("Invalid event date: " + isoDate);

  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);

  // Use the unified parser — handles "8am", "8:30pm", "20:30", "8", "08:30".
  // Falls back to "00:00" if the string is empty or unparseable.
  const normalisedTime = parseHospitalityTime_(timeText) || "00:00";
  const timeParts = normalisedTime.split(":");

  const hh = Number(timeParts[0] || 0);
  const mm = Number(timeParts[1] || 0);

  const dt = new Date(y, m, d, hh, mm, 0, 0);
  if (
    isNaN(dt.getTime()) ||
    dt.getFullYear() !== y ||
    dt.getMonth() !== m ||
    dt.getDate() !== d
  ) {
    throw new Error("Invalid calendar start date or time.");
  }

  return dt;
}

function applyCalendarStartOffset_(start, offsetMinutes) {
  const offset = Number(offsetMinutes || 0);
  if (!offset) return start;

  return new Date(start.getTime() + offset * 60 * 1000);
}

function resetCalendarForRow(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  booking.calendarEventId = "";
  booking.calendarEventUrl = "";
  booking.calendarCreatedAt = "";
  booking.calendarStale = false;

  booking.status = booking.quoteUrl
    ? CONFIG.STATUS.QUOTE_GENERATED
    : CONFIG.STATUS.READY;

  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return { ok: true };
}

function getOptionalSourceBookingFile_(booking) {
  if (booking.sourceType === "CLIENT_PLATFORM" || String(booking.messageId || "").indexOf("CLIENT:") === 0) {
    return null;
  }
  return getOrCreateOriginalBookingXlsxFile_(booking);
}
