function createCalendarEventForRow(rowNumber) {
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
  const sourceXlsxFile = getOrCreateOriginalBookingXlsxFile_(booking);

  const attendees = getCalendarAttendeesFromSettings_();
  const calendarId = getConfiguredValue_("CALENDAR_ID", CONFIG.CALENDAR_ID || "primary");
  const eventDuration = getConfiguredNumber_("CALENDAR_EVENT_DURATION_MINUTES", CONFIG.CALENDAR_EVENT_DURATION_MINUTES || 60);
  const eventColorId = getConfiguredValue_("CALENDAR_EVENT_COLOR_ID", CONFIG.CALENDAR_EVENT_COLOR_ID || "9");

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

  const start = buildCalendarStart_(booking.eventDate, booking.serviceTimes[0]);
  const end = new Date(start.getTime() + eventDuration * 60 * 1000);

  const warnForLateAmendment = shouldWarnForStaleCalendarRegeneration_(isStaleRegeneration, start, new Date());
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
    },
    colorId: eventColorId,
    attendees: attendees,
    attachments: [
      {
        fileUrl: quoteFile.getUrl(),
        title: quoteFile.getName(),
        mimeType: quoteFile.getMimeType()
      },
      {
        fileUrl: sourceXlsxFile.getUrl(),
        title: sourceXlsxFile.getName(),
        mimeType: sourceXlsxFile.getMimeType()
      }
    ]
  };

  const created = Calendar.Events.insert(
    eventResource,
    calendarId,
    { supportsAttachments: true, sendUpdates: "all" }
  );

  booking.originalBookingFileId = sourceXlsxFile.getId();
  booking.originalBookingFileUrl = sourceXlsxFile.getUrl();

  booking.calendarEventId = created.id || "";
  booking.calendarEventUrl = created.htmlLink || "";
  booking.calendarCreatedAt = new Date();
  booking.status = CONFIG.STATUS.CPU_CREATED;
  booking.updatedAt = new Date();
  booking.calendarStale = false;

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return { ok: true, eventUrl: created.htmlLink || "" };
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

function getOriginalBookingFormUrlForRow(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  const booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");
  if (!booking.messageId) throw new Error("This booking has no source email reference.");

  const file = getOrCreateOriginalBookingXlsxFile_(booking);

  booking.originalBookingFileId = file.getId();
  booking.originalBookingFileUrl = file.getUrl();
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return {
    ok: true,
    url: file.getUrl()
  };
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

function getCalendarAttendeesFromSettings_() {
  return String(
    getConfiguredValue_(
      "CALENDAR_ATTENDEES",
      (CONFIG.CALENDAR_ATTENDEES || []).join(", ")
    )
  )
    .split(",")
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => ({ email }));
}

function makeCalendarTitle_(booking) {
  const locationShortCode =
    getConfiguredValue_("LOCATION_SHORT_CODE", CONFIG.LOCATION_SHORT_CODE || "58VE");
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
  const parts = String(isoDate).split("-");
  if (parts.length !== 3) throw new Error("Invalid event date: " + isoDate);

  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);

  // Use the unified parser — handles "8am", "8:30pm", "20:30", "8", "08:30".
  // Falls back to "00:00" if the string is empty or unparseable.
  const normalisedTime = parseHospitalityTime_(timeText) || "00:00";
  const timeParts = normalisedTime.split(":");

  const hh = Number(timeParts[0] || 0);
  const mm = Number(timeParts[1] || 0);

  const dt = new Date(y, m, d, hh, mm, 0, 0);
  if (isNaN(dt.getTime())) throw new Error("Invalid calendar start time.");

  return dt;
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
