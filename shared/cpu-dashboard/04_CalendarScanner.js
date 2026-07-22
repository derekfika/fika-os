function scanCpuCalendars(options) {
  options = options || {};
  const deepMode = resolveCpuDeepScanMode_(options);
  const calendars = getCpuCalendars_();
  if (!calendars.length) {
    throw new Error("No calendars are configured. Add the CPU calendar to CPU Settings > CALENDARS_JSON.");
  }

  const today = cpuStartOfDay_(new Date());
  const start = options.start
    ? new Date(options.start)
    : cpuAddDays_(today, -cpuNumberSetting_("SCAN_LOOKBACK_DAYS", CPU_CONFIG.DEFAULT_LOOKBACK_DAYS));
  const end = options.end
    ? new Date(options.end)
    : cpuAddDays_(today, cpuNumberSetting_("SCAN_LOOKAHEAD_DAYS", CPU_CONFIG.DEFAULT_LOOKAHEAD_DAYS));

  const allOrders = [];
  const allDeliveries = [];
  const scanWarnings = [];
  const existingSources = getCpuOrderSourceMap_();
  let unchanged = 0;

  calendars.forEach(function(calendar) {
    try {
      const events = listCpuCalendarEvents_(calendar.id, start, end);
      events.forEach(function(event) {
        try {
          if (event.status === "cancelled") return;
          if (looksLikeCpuDeliveryEvent_(event)) {
            allDeliveries.push(parseCpuDeliveryEvent_(event, calendar));
            return;
          }
          if (!(event.attachments || []).length && !looksLikeCpuHospitalityEvent_(event)) return;
          const orderKey = calendar.id + "::" + event.id;
          const sourceUpdatedAt = getCpuEventSourceVersion_(event);
          if (!deepMode && sourceUpdatedAt && existingSources[orderKey] === sourceUpdatedAt) {
            unchanged += 1;
            return;
          }
          allOrders.push(parseCpuEvent_(event, calendar));
        } catch (error) {
          scanWarnings.push(calendar.name + " / " + (event.summary || event.id) + ": " + error.message);
        }
      });
    } catch (error) {
      scanWarnings.push(calendar.name + ": " + error.message);
    }
  });

  const saved = upsertCpuOrders_(allOrders);
  const deliveriesSaved = upsertCpuDeliveries_(allDeliveries);
  ensureCpuScanLogSheet_().appendRow([
    new Date(),
    Session.getActiveUser().getEmail(),
    start,
    end,
    calendars.length,
    saved,
    scanWarnings.join("\n")
  ]);

  return {
    ok: true,
    calendars: calendars.length,
    orders: saved,
    deliveries: deliveriesSaved,
    deepMode: deepMode,
    unchanged: unchanged,
    warnings: scanWarnings,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString()
  };
}

function listCpuCalendarEvents_(calendarId, start, end) {
  const events = [];
  let pageToken = "";
  do {
    const response = Calendar.Events.list(calendarId, {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: CPU_CONFIG.CALENDAR_PAGE_SIZE,
      pageToken: pageToken || undefined,
      fields: "items(id,status,summary,description,location,start,end,updated,htmlLink,creator,organizer,attendees,attachments),nextPageToken"
    });
    Array.prototype.push.apply(events, response.items || []);
    pageToken = response.nextPageToken || "";
  } while (pageToken);
  return events;
}

function looksLikeCpuHospitalityEvent_(event) {
  const summary = String(event.summary || "");
  const text = [event.summary, event.description].join(" ").toLowerCase();

  if (text.indexOf("delivery scheduled") !== -1 || text.indexOf("delivery reminder") !== -1) {
    return false;
  }

  return text.indexOf("hospitality") !== -1 ||
    /^([^_]+)_([^_]+)_([^x]+)\s+x\s*\d+/i.test(summary);
}

function looksLikeCpuDeliveryEvent_(event) {
  return /\bdelivery\s+(?:scheduled|schedule|reminder|collection)\b/i.test(
    [event.summary, event.description].join(" ")
  );
}

function parseCpuDeliveryEvent_(event, sourceCalendar) {
  const startAt = new Date((event.start || {}).dateTime || (event.start || {}).date);
  const endAt = new Date((event.end || {}).dateTime || (event.end || {}).date);
  const ownerEmail = String((event.creator || {}).email || (event.organizer || {}).email || "").toLowerCase();
  const site = resolveCpuSite_(event.location || event.summary || sourceCalendar.name, sourceCalendar, ownerEmail);
  const driver = resolveCpuDeliveryDriver_(event);
  return {
    deliveryKey: sourceCalendar.id + "::" + event.id,
    calendarId: sourceCalendar.id,
    calendarEventId: event.id || "",
    calendarEventUrl: event.htmlLink || "",
    eventDate: Utilities.formatDate(startAt, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    startAt: cpuIso_(startAt),
    endAt: cpuIso_(endAt),
    summary: event.summary || "Delivery scheduled",
    description: cpuCleanHtmlText_(event.description || ""),
    location: event.location || site.name,
    siteId: site.id, siteName: site.name, siteCode: site.code, siteColour: site.colour,
    eventOwnerEmail: ownerEmail,
    driverEmail: driver.email,
    driverName: driver.name,
    driverColour: driver.colour,
    sourceUpdatedAt: event.updated || "",
    scannedAt: new Date().toISOString()
  };
}

function resolveCpuDeliveryDriver_(event) {
  const emails = (event.attendees || []).map(function(attendee) {
    return String(attendee.email || "").trim().toLowerCase();
  });
  for (let i = 0; i < CPU_DRIVER_DIRECTORY.length; i++) {
    if (emails.indexOf(CPU_DRIVER_DIRECTORY[i].email) !== -1) {
      return CPU_DRIVER_DIRECTORY[i];
    }
  }
  return { email: "", name: "Unassigned", colour: "#8B8496" };
}

function installCpuRefreshTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return trigger.getHandlerFunction() === "scheduledCpuCalendarRefresh"; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger("scheduledCpuCalendarRefresh")
    .timeBased()
    .everyHours(1)
    .create();
  return { ok: true, message: "Hourly CPU calendar refresh installed." };
}

function scheduledCpuCalendarRefresh() {
  return scanCpuCalendars();
}

function startCpuCalendarScanJob(options) {
  options = options || {};
  const deepMode = resolveCpuDeepScanMode_(options);
  const calendars = getCpuCalendars_();
  if (!calendars.length) {
    throw new Error("No calendars are configured.");
  }

  const today = cpuStartOfDay_(new Date());
  const start = options.start
    ? new Date(options.start + (String(options.start).length === 10 ? "T00:00:00" : ""))
    : cpuAddDays_(today, -cpuNumberSetting_("SCAN_LOOKBACK_DAYS", CPU_CONFIG.DEFAULT_LOOKBACK_DAYS));
  const end = options.end
    ? new Date(options.end + (String(options.end).length === 10 ? "T23:59:59" : ""))
    : cpuAddDays_(today, cpuNumberSetting_("SCAN_LOOKAHEAD_DAYS", CPU_CONFIG.DEFAULT_LOOKAHEAD_DAYS));
  const jobId = Utilities.getUuid();
  const job = {
    id: jobId,
    status: "RUNNING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
    deepMode: deepMode,
    calendarIndex: 0,
    pageToken: "",
    current: "Preparing calendar scan…",
    counters: {
      calendars: calendars.length,
      found: 0,
      logged: 0,
      unchanged: 0,
      skipped: 0,
      attention: 0,
      errors: 0
    },
    errors: [],
    cancelled: false
  };
  saveCpuScanJob_(job);
  return cpuPublicScanJob_(job);
}

function processCpuCalendarScanChunk(jobId) {
    const job = loadCpuScanJob_(jobId);
    if (!job) throw new Error("Scan job expired. Start a new scan.");
    if (job.status !== "RUNNING") return cpuPublicScanJob_(job);

    if (job.cancelled) {
      job.status = "CANCELLED";
      job.current = "Scan cancelled.";
      saveCpuScanJob_(job);
      return cpuPublicScanJob_(job);
    }

    const calendars = getCpuCalendars_();
    const existingSources = getCpuOrderSourceMap_();
    while (job.calendarIndex < calendars.length) {
      const calendar = calendars[job.calendarIndex];
      const response = Calendar.Events.list(calendar.id, {
        timeMin: job.rangeStart,
        timeMax: job.rangeEnd,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: CPU_CONFIG.SCAN_CHUNK_EVENTS,
        pageToken: job.pageToken || undefined,
        fields: "items(id,status,summary,description,location,start,end,updated,htmlLink,creator,organizer,attendees,attachments),nextPageToken"
      });
      const events = response.items || [];
      const parsedOrders = [];
      const parsedDeliveries = [];

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        job.counters.found += 1;
        job.current = calendar.name + " · " + (event.summary || "Untitled event");

        try {
          if (event.status === "cancelled") {
            job.counters.skipped += 1;
          } else if (looksLikeCpuDeliveryEvent_(event)) {
            parsedDeliveries.push(parseCpuDeliveryEvent_(event, calendar));
            job.counters.logged += 1;
          } else if (
            !(event.attachments || []).length &&
            !extractCpuDescriptionAttachments_(event.description || "").length &&
            !looksLikeCpuHospitalityEvent_(event)
          ) {
            job.counters.skipped += 1;
          } else {
            const orderKey = calendar.id + "::" + event.id;
            const sourceUpdatedAt = getCpuEventSourceVersion_(event);
            if (!job.deepMode && sourceUpdatedAt && existingSources[orderKey] === sourceUpdatedAt) {
              job.counters.unchanged = (job.counters.unchanged || 0) + 1;
              continue;
            }
            const order = parseCpuEvent_(event, calendar);
            parsedOrders.push(order);
            job.counters.logged += 1;
            if (order.status === CPU_CONFIG.STATUS.NEEDS_ATTENTION) {
              job.counters.attention += 1;
            }
          }
        } catch (error) {
          job.counters.errors += 1;
          if (job.errors.length < 10) {
            job.errors.push(
              ((event.summary || event.id || "Event") + ": " + error.message).slice(0, 300)
            );
          }
        }
      }
      if (parsedOrders.length) upsertCpuOrders_(parsedOrders);
      if (parsedDeliveries.length) upsertCpuDeliveries_(parsedDeliveries);

      if (response.nextPageToken) {
        job.pageToken = response.nextPageToken;
      } else {
        advanceCpuScanCalendar_(job, calendar);
      }
      break;
    }

    if (job.calendarIndex >= calendars.length) {
      job.status = "COMPLETE";
      job.current = "Calendar scan complete.";
      ensureCpuScanLogSheet_().appendRow([
        new Date(),
        Session.getActiveUser().getEmail(),
        new Date(job.rangeStart),
        new Date(job.rangeEnd),
        job.counters.calendars,
        job.counters.logged,
        job.errors.join("\n")
      ]);
    }

    job.updatedAt = new Date().toISOString();
    saveCpuScanJob_(job);
    return cpuPublicScanJob_(job);
}

function cancelCpuCalendarScanJob(jobId) {
  const job = loadCpuScanJob_(jobId);
  if (!job) return { ok: true };
  job.cancelled = true;
  job.status = "CANCELLED";
  job.current = "Scan cancelled.";
  job.updatedAt = new Date().toISOString();
  saveCpuScanJob_(job);
  return cpuPublicScanJob_(job);
}

function advanceCpuScanCalendar_(job, calendar) {
  job.calendarIndex += 1;
  job.pageToken = "";
  job.current = "Finished " + calendar.name;
}

function saveCpuScanJob_(job) {
  PropertiesService.getScriptProperties().setProperty(
    "CPU_SCAN_JOB_" + job.id,
    JSON.stringify(job)
  );
}

function loadCpuScanJob_(jobId) {
  const raw = PropertiesService.getScriptProperties().getProperty("CPU_SCAN_JOB_" + jobId);
  if (!raw) return null;
  const job = JSON.parse(raw);
  const ageSeconds = (Date.now() - new Date(job.updatedAt || job.createdAt).getTime()) / 1000;
  if (ageSeconds > CPU_CONFIG.SCAN_JOB_TTL_SECONDS) {
    PropertiesService.getScriptProperties().deleteProperty("CPU_SCAN_JOB_" + jobId);
    return null;
  }
  return job;
}

function cpuPublicScanJob_(job) {
  return {
    id: job.id,
    status: job.status,
    deepMode: Boolean(job.deepMode),
    current: job.current,
    counters: job.counters,
    errors: job.errors || [],
    rangeStart: job.rangeStart,
    rangeEnd: job.rangeEnd
  };
}

function resolveCpuDeepScanMode_(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, "deepMode")) {
    const value = String(options.deepMode).trim().toUpperCase();
    return options.deepMode === true || value === "TRUE" || value === "YES" || value === "1";
  }
  return cpuBoolSetting_("DEEP_SCAN_MODE", false);
}

function cpuStartOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function cpuAddDays_(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getCpuEventSourceVersion_(event) {
  const parts = [String(event.updated || "").trim()];
  const jsonAttachment = (event.attachments || []).filter(function(attachment) {
    return cpuJsonAttachmentScore_(attachment) > 0;
  })[0];

  if (jsonAttachment) {
    const id =
      jsonAttachment.fileId ||
      extractCpuDriveId_(jsonAttachment.fileUrl || "");
    if (id) {
      try {
        parts.push(DriveApp.getFileById(id).getLastUpdated().toISOString());
      } catch (error) {
        parts.push("json-unreadable");
      }
    }
  }

  return parts.filter(Boolean).join("|");
}
