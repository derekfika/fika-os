function getClientPortalData(accessPin) {
  validatePortalAccess_(accessPin);
  const bookings = readClientBookings_();
  return {
    viewer: { name: CLIENT_PORTAL_CONFIG.CLIENT_NAME },
    site: {
      name: CLIENT_PORTAL_CONFIG.SITE_NAME,
      supportEmail: CLIENT_PORTAL_CONFIG.SUPPORT_EMAIL,
      bookingUrl: CLIENT_PORTAL_CONFIG.BOOKING_PLATFORM_URL
    },
    generatedAt: new Date().toISOString(),
    bookings: bookings
  };
}

function validatePortalAccess_(accessPin) {
  const expected = String(PropertiesService.getScriptProperties().getProperty("ACCESS_PIN") || "").trim();
  const supplied = String(accessPin || "").trim();
  if (!expected) throw new Error("The portal PIN has not been configured. Please contact the Fika team.");
  if (!supplied || supplied !== expected) throw new Error("That PIN is not correct. Please try again.");
}

function readClientBookings_() {
  const ss = SpreadsheetApp.openById(CLIENT_PORTAL_CONFIG.DASHBOARD_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CLIENT_PORTAL_CONFIG.DASHBOARD_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) { return String(value || "").trim(); });
  const map = {};
  headers.forEach(function(header, index) { map[header] = index; });
  ["BookingID", "EventDate"].forEach(function(header) {
    if (map[header] === undefined) throw new Error("Portal data is missing the " + header + " column.");
  });

  return values.slice(1).filter(function(row) {
    if (!row.some(function(cell) { return cell !== "" && cell !== null; })) return false;
    const parsed = safeJson_(value_(row, map, "ParsedJSON"), {});
    return isClientVisibleBooking_(value_(row, map, "Status") || parsed.status, parsed);
  }).map(function(row) {
    const parsed = safeJson_(map.ParsedJSON === undefined ? "" : row[map.ParsedJSON], {});
    return sanitiseClientBooking_(row, map, parsed);
  }).sort(function(a, b) {
    return String(b.eventDate).localeCompare(String(a.eventDate)) || String(b.startTime).localeCompare(String(a.startTime));
  });
}

function isClientVisibleBooking_(status, parsed) {
  const value = String(status || "").trim().toUpperCase();
  if (["CONFIRMED", "ARCHIVED", "RECHARGED"].indexOf(value) >= 0) return true;
  // A subsequently cancelled booking remains in Felipe's history only if it
  // previously completed the confirmation-email workflow.
  return value === "CANCELLED" && Boolean(parsed && parsed.confirmationEmailSentAt);
}

function sanitiseClientBooking_(row, map, parsed) {
  const serviceTimes = safeJson_(value_(row, map, "ServiceTimes"), parsed.serviceTimes || []);
  const items = safeJson_(value_(row, map, "ItemsJSON"), parsed.items || []);
  const location = cleanClientLocation_(value_(row, map, "Location") || parsed.location || "");
  const floor = String(value_(row, map, "Floor") || parsed.floor || "").trim();
  const clientEvent = parsed.clientBooking && parsed.clientBooking.event || {};
  const requestEvent = parsed.clientRequest && parsed.clientRequest.event || {};
  return {
    bookingId: String(value_(row, map, "BookingID") || parsed.bookingId || ""),
    status: clientStatus_(value_(row, map, "Status") || parsed.status),
    eventDate: isoDate_(value_(row, map, "EventDate") || parsed.eventDate),
    startTime: firstServiceTime_(serviceTimes),
    pax: Number(value_(row, map, "Pax") || parsed.pax || 0),
    serviceType: String(value_(row, map, "ServiceType") || parsed.serviceType || "Hospitality"),
    location: location,
    floor: floor,
    room: String(parsed.room || parsed.roomOrArea || clientEvent.roomOrArea || clientEvent.deliveryPoint || requestEvent.roomOrArea || requestEvent.deliveryPoint || "").trim(),
    items: Array.isArray(items) ? items.map(sanitiseClientItem_).filter(function(item) { return item.name; }) : []
  };
}

function cleanClientLocation_(value) {
  const address = "110 Bishopsgate, EC2N 4AY";
  return String(value || "").replace(address, "").replace(/^\s*[·,\-–—]+\s*|\s*[·,\-–—]+\s*$/g, "").trim();
}

function sanitiseClientItem_(item) {
  return {
    section: String(item.section || item.category || "").trim(),
    name: String(item.name || item.itemName || "").trim(),
    detail: String(item.detail || "").trim(),
    quantity: Number(item.qty || item.quantity || 0),
    time: String(item.time || item.timeRequired || "").trim()
  };
}

function clientStatus_(status) {
  const value = String(status || "").toUpperCase();
  if (value === "CANCELLED") return "Cancelled";
  if (["CONFIRMED", "RECHARGED", "ARCHIVED"].indexOf(value) >= 0) return "Confirmed";
  if (["QUOTE_GENERATED", "READY", "NEW"].indexOf(value) >= 0) return "In progress";
  return "Being reviewed";
}

function firstServiceTime_(times) {
  if (!Array.isArray(times) || !times.length) return "";
  const first = times[0];
  if (typeof first === "string") return first;
  return String(first.time || first.startTime || "");
}

function value_(row, map, header) {
  return map[header] === undefined ? "" : row[map[header]];
}

function safeJson_(value, fallback) {
  try { return typeof value === "string" ? JSON.parse(value || "null") || fallback : value || fallback; }
  catch (error) { return fallback; }
}

function isoDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CLIENT_PORTAL_CONFIG.TIMEZONE, "yyyy-MM-dd");
  }
  return String(value || "").slice(0, 10);
}
