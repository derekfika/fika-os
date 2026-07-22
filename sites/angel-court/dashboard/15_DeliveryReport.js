function generateHospitalityDeliveryPdf(startDate, endDate) {
  const range = normaliseDeliveryReportDateRange_(startDate, endDate);
  const bookings = getDeliveryReportBookings_(range.start, range.end);
  const siteName = getConfiguredValue_("APP_NAME", CONFIG.APP_NAME || "Hospitality Dashboard");
  const html = buildDeliveryReportHtml_(bookings, range, siteName);
  const fileName = makeDeliveryReportFileName_(siteName, range);
  const blob = HtmlService
    .createHtmlOutput(html)
    .getBlob()
    .getAs(MimeType.PDF)
    .setName(fileName);
  const folder = getOrCreateDeliveryReportFolder_();
  const file = folder.createFile(blob);

  return {
    ok: true,
    url: file.getUrl(),
    fileId: file.getId(),
    fileName: file.getName(),
    count: bookings.length
  };
}

function normaliseDeliveryReportDateRange_(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || startDate || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error("Choose a valid report start date.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Choose a valid report end date.");
  }

  if (end < start) {
    throw new Error("The report end date must be after the start date.");
  }

  return { start: start, end: end };
}

function getDeliveryReportBookings_(startDate, endDate) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const parsedJsonCol = map.ParsedJSON;
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  return sh
    .getRange(2, parsedJsonCol, lastRow - 1, 1)
    .getValues()
    .map(function(row) {
      return safeJsonParse_(row[0], null);
    })
    .filter(function(booking) {
      if (!booking) return false;
      const date = String(booking.eventDate || "").slice(0, 10);
      const status = String(booking.status || "").toUpperCase();
      if (!date || date < startDate || date > endDate) return false;
      return ["CANCELLED", "ARCHIVED", "RECHARGED"].indexOf(status) === -1;
    })
    .sort(function(a, b) {
      const aKey = [a.eventDate || "", getFirstDeliveryReportTime_(a), a.clientCompany || ""].join("|");
      const bKey = [b.eventDate || "", getFirstDeliveryReportTime_(b), b.clientCompany || ""].join("|");
      return aKey.localeCompare(bKey);
    });
}

function buildDeliveryReportHtml_(bookings, range, siteName) {
  const generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  const grouped = groupDeliveryReportBookingsByDate_(bookings);
  const dateKeys = Object.keys(grouped).sort();
  const bodyHtml = dateKeys.length
    ? dateKeys.map(function(date) {
      return buildDeliveryReportDayHtml_(date, grouped[date]);
    }).join("")
    : '<div class="empty">No active hospitality bookings found for this date range.</div>';

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>',
    '@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#221874;margin:0;font-size:11px;line-height:1.35}h1,h2,h3,p{margin:0}h1{font-size:24px;line-height:1.05}h2{font-size:15px;margin:18px 0 8px;border-bottom:2px solid #4F34C7;padding-bottom:5px}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.brand{font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:#4F34C7;margin-bottom:6px}.meta{text-align:right;color:#5f5a82}.summary{display:flex;gap:8px;margin:12px 0 18px}.summary div{border:1px solid #d9d7e3;border-radius:8px;padding:8px 10px;min-width:110px}.summary strong{display:block;font-size:18px;color:#4F34C7}.booking{break-inside:avoid;border:1px solid #d9d7e3;border-radius:10px;margin:0 0 10px;overflow:hidden}.booking-head{background:#f4f3ff;padding:10px 12px;display:grid;grid-template-columns:80px 1fr 80px;gap:10px;align-items:start}.time{font-size:18px;font-weight:bold;color:#4F34C7}.title{font-weight:bold;font-size:13px}.badge{display:inline-block;border:1px solid #d9d7e3;border-radius:99px;padding:2px 7px;font-size:9px;text-transform:uppercase;color:#5f5a82;background:#fff}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:9px 12px;border-top:1px solid #ece9f8}.fact span{display:block;color:#5f5a82;font-size:9px;text-transform:uppercase;letter-spacing:.5px}.notes{padding:8px 12px;color:#9e3434;font-weight:bold;border-top:1px solid #f0d6d6;background:#fff8f8}.items{width:100%;border-collapse:collapse}.items th{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5f5a82;text-align:left;background:#faf9ff;border-top:1px solid #ece9f8;border-bottom:1px solid #ece9f8;padding:6px}.items td{vertical-align:top;border-bottom:1px solid #f1eff8;padding:6px}.items tr:last-child td{border-bottom:0}.item-name{font-weight:bold}.muted{color:#5f5a82}.item-note{color:#9e3434;font-weight:bold;margin-top:3px}.empty{border:1px dashed #d9d7e3;border-radius:10px;padding:24px;text-align:center;color:#5f5a82}.money{text-align:right;white-space:nowrap}.footer{margin-top:18px;color:#5f5a82;font-size:9px}',
    '</style></head><body>',
    '<div class="header"><div><div class="brand">FIKA Hospitality</div><h1>',
    escapeDeliveryReportHtml_(siteName),
    '</h1><p class="muted">Delivery report for ',
    escapeDeliveryReportHtml_(formatDeliveryReportDate_(range.start)),
    ' to ',
    escapeDeliveryReportHtml_(formatDeliveryReportDate_(range.end)),
    '</p></div><div class="meta">Generated ',
    escapeDeliveryReportHtml_(generatedAt),
    '</div></div>',
    '<div class="summary"><div><strong>',
    String(bookings.length),
    '</strong>Bookings</div><div><strong>',
    String(sumDeliveryReportPax_(bookings)),
    '</strong>Total pax</div></div>',
    bodyHtml,
    '<div class="footer">Cancelled, archived and recharged bookings are excluded.</div>',
    '</body></html>'
  ].join("");
}

function groupDeliveryReportBookingsByDate_(bookings) {
  return bookings.reduce(function(grouped, booking) {
    const date = String(booking.eventDate || "").slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(booking);
    return grouped;
  }, {});
}

function buildDeliveryReportDayHtml_(date, bookings) {
  return [
    '<h2>',
    escapeDeliveryReportHtml_(formatDeliveryReportDate_(date)),
    '</h2>',
    bookings.map(buildDeliveryReportBookingHtml_).join("")
  ].join("");
}

function buildDeliveryReportBookingHtml_(booking) {
  const items = getDeliveryReportItems_(booking);
  const notes = getDeliveryReportNotes_(booking);

  return [
    '<section class="booking"><div class="booking-head"><div class="time">',
    escapeDeliveryReportHtml_(getFirstDeliveryReportTime_(booking) || "-"),
    '</div><div><div class="title">',
    escapeDeliveryReportHtml_(booking.clientCompany || "Hospitality booking"),
    '</div><div class="muted">',
    escapeDeliveryReportHtml_(booking.serviceType || ""),
    '</div></div><div><span class="badge">',
    escapeDeliveryReportHtml_(booking.status || ""),
    '</span></div></div>',
    '<div class="facts">',
    deliveryReportFact_("Room", getDeliveryReportRoom_(booking) || "-"),
    deliveryReportFact_("Floor", booking.floor || "-"),
    deliveryReportFact_("Pax", booking.pax || "-"),
    deliveryReportFact_("Host", booking.hostName || booking.hostEmail || "-"),
    '</div>',
    notes ? '<div class="notes">' + escapeDeliveryReportHtml_(notes) + '</div>' : '',
    buildDeliveryReportItemsHtml_(items),
    '</section>'
  ].join("");
}

function deliveryReportFact_(label, value) {
  return '<div class="fact"><span>' + escapeDeliveryReportHtml_(label) + '</span>' + escapeDeliveryReportHtml_(value) + '</div>';
}

function buildDeliveryReportItemsHtml_(items) {
  if (!items.length) return '<div class="notes">No line items recorded.</div>';

  return [
    '<table class="items"><thead><tr><th style="width:58px">Time</th><th>Item</th><th style="width:52px">Qty</th><th>Delivery detail</th><th style="width:72px;text-align:right">Total</th></tr></thead><tbody>',
    items.map(function(item) {
      const detail = [
        item.detail,
        item.info,
        getDeliveryReportChoiceText_(item)
      ].filter(Boolean).join(" - ");
      const itemNote = getDeliveryReportItemNotes_(item);
      return [
        '<tr><td>',
        escapeDeliveryReportHtml_(item.time || item.serviceTime || ""),
        '</td><td><div class="item-name">',
        escapeDeliveryReportHtml_(item.name || "Untitled item"),
        '</div><div class="muted">',
        escapeDeliveryReportHtml_(item.section || ""),
        '</div></td><td>',
        escapeDeliveryReportHtml_(item.qty || item.quantity || ""),
        '</td><td>',
        escapeDeliveryReportHtml_(detail),
        itemNote ? '<div class="item-note">' + escapeDeliveryReportHtml_(itemNote) + '</div>' : '',
        '</td><td class="money">',
        escapeDeliveryReportHtml_(formatDeliveryReportMoney_(getDeliveryReportLineTotal_(item))),
        '</td></tr>'
      ].join("");
    }).join(""),
    '</tbody></table>'
  ].join("");
}

function getDeliveryReportItems_(booking) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const sourceItems = booking.clientBooking &&
    booking.clientBooking.order &&
    Array.isArray(booking.clientBooking.order.items)
      ? booking.clientBooking.order.items
      : [];
  const sourceById = {};

  sourceItems.forEach(function(item) {
    if (item && item.itemId) sourceById[item.itemId] = item;
  });

  return items.map(function(item) {
    if (!item || !item.itemId || !sourceById[item.itemId]) return item;

    const source = sourceById[item.itemId];
    return Object.assign({}, item, {
      info: item.info || source.description || "",
      comment: item.comment || item.comments || source.comment || source.comments || "",
      allergenInfo: item.allergenInfo || item.allergens || source.allergenInfo || source.allergens || source.allergyDetails || "",
      requirements: item.requirements || item.specialRequirements || item.specialInstructions || source.requirements || source.specialRequirements || source.specialInstructions || "",
      choices: item.choices || source.choices || source.selectedChoices || null
    });
  });
}

function getDeliveryReportNotes_(booking) {
  return [
    booking.notes,
    booking.dietaryRequirements,
    booking.allergyDetails,
    booking.allergenInfo
  ].filter(Boolean).join(" - ");
}

function getDeliveryReportChoiceText_(item) {
  const choices = item.choices;
  if (!choices) return "";

  if (Array.isArray(choices)) {
    return choices
      .map(function(choice) {
        if (!choice) return "";
        if (typeof choice === "string") return choice;
        return choice.label || choice.name || choice.value || "";
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof choices === "object") {
    return Object.keys(choices)
      .map(function(key) {
        const value = choices[key];
        if (Array.isArray(value)) return value.filter(Boolean).join(", ");
        if (value && typeof value === "object") return value.label || value.name || value.value || "";
        return value;
      })
      .filter(Boolean)
      .join(", ");
  }

  return String(choices || "");
}

function getDeliveryReportItemNotes_(item) {
  return [
    item.comment || item.comments,
    item.allergenInfo || item.allergens || item.allergyDetails,
    item.requirements || item.specialRequirements || item.specialInstructions
  ].filter(Boolean).join(" - ");
}

function getDeliveryReportRoom_(booking) {
  const clientEvent = booking.clientBooking && booking.clientBooking.event
    ? booking.clientBooking.event
    : {};

  return booking.room ||
    booking.roomOrArea ||
    booking.deliveryPoint ||
    clientEvent.roomOrArea ||
    clientEvent.deliveryPoint ||
    booking.location ||
    "";
}

function getFirstDeliveryReportTime_(booking) {
  if (booking.serviceTimes && booking.serviceTimes.length) return String(booking.serviceTimes[0] || "");
  const items = Array.isArray(booking.items) ? booking.items : [];
  const itemWithTime = items.find(function(item) { return item && item.time; });
  return itemWithTime ? String(itemWithTime.time || "") : "";
}

function getDeliveryReportLineTotal_(item) {
  if (isFiniteDeliveryReportNumber_(item.lineTotal)) return Number(item.lineTotal);
  const quantity = isFiniteDeliveryReportNumber_(item.qty) ? item.qty : item.quantity;
  if (isFiniteDeliveryReportNumber_(item.unitPrice) && isFiniteDeliveryReportNumber_(quantity)) {
    return Number(item.unitPrice) * Number(quantity);
  }
  return null;
}

function sumDeliveryReportPax_(bookings) {
  return bookings.reduce(function(total, booking) {
    return total + (Number(booking.pax || 0) || 0);
  }, 0);
}

function formatDeliveryReportMoney_(value) {
  return value === null || value === undefined ? "" : "GBP " + Number(value || 0).toFixed(2);
}

function formatDeliveryReportDate_(isoDate) {
  const parts = String(isoDate || "").split("-");
  if (parts.length !== 3) return isoDate || "";
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEE dd MMM yyyy");
}

function makeDeliveryReportFileName_(siteName, range) {
  return sanitiseDeliveryReportFileName_(siteName + " Delivery Report " + range.start + " to " + range.end) + ".pdf";
}

function sanitiseDeliveryReportFileName_(name) {
  return String(name || "Hospitality Delivery Report").replace(/[\\/:*?"<>|]/g, "-");
}

function getOrCreateDeliveryReportFolder_() {
  const name = "Hospitality Delivery Reports";
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function isFiniteDeliveryReportNumber_(value) {
  if (value === "" || value === null || value === undefined) return false;
  return isFinite(Number(value));
}

function escapeDeliveryReportHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
