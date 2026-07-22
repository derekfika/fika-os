function upsertCpuOrders_(orders) {
  if (!orders || !orders.length) return 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = ensureCpuOrdersSheet_();
    const headers = CPU_CONFIG.ORDER_HEADERS;
    const existingRows = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
      : [];
    const rowByKey = {};
    existingRows.forEach(function(row, index) {
      rowByKey[String(row[0])] = { rowNumber: index + 2, values: row };
    });

    const newRows = [];
    orders.forEach(function(order) {
      const existing = rowByKey[order.orderKey];
      if (existing) {
        const changes = getCpuOrderChanges_(existing.values, order, headers);
        order.changes = changes.length
          ? changes
          : cpuJson_(existing.values[headers.indexOf("ChangesJSON")], []);
        order.changedAt = changes.length
          ? new Date().toISOString()
          : cpuSheetIso_(existing.values[headers.indexOf("ChangedAt")]);
        order.prepped = cpuSheetBoolean_(existing.values[headers.indexOf("Prepped")]);
        order.preppedAt = cpuSheetIso_(existing.values[headers.indexOf("PreppedAt")]);
        order.preppedBy = String(existing.values[headers.indexOf("PreppedBy")] || "").trim();
        order.prepPhotoFileId = String(existing.values[headers.indexOf("PrepPhotoFileId")] || "").trim();
        order.prepPhotoUrl = String(existing.values[headers.indexOf("PrepPhotoUrl")] || "").trim();
        order.prepPhotoAt = cpuSheetIso_(existing.values[headers.indexOf("PrepPhotoAt")]);
        order.allergenPhotoFileId = String(existing.values[headers.indexOf("AllergenPhotoFileId")] || "").trim();
        order.allergenPhotoUrl = String(existing.values[headers.indexOf("AllergenPhotoUrl")] || "").trim();
        order.allergenPhotoAt = cpuSheetIso_(existing.values[headers.indexOf("AllergenPhotoAt")]);
        order.prepPhotos = cpuJson_(existing.values[headers.indexOf("PrepPhotosJSON")], []);
        order.allergenPhotos = cpuJson_(existing.values[headers.indexOf("AllergenPhotosJSON")], []);
      }
      const values = cpuOrderToRow_(order);
      if (existing) {
        sheet.getRange(existing.rowNumber, 1, 1, values.length).setValues([values]);
      } else {
        newRows.push(values);
      }
    });
    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length)
        .setValues(newRows);
    }
    bumpCpuDataVersion_();
    return orders.length;
  } finally {
    lock.releaseLock();
  }
}

function cpuOrderToRow_(order) {
  const valueByHeader = {
    OrderKey: order.orderKey,
    CalendarId: order.calendarId,
    CalendarEventId: order.calendarEventId,
    CalendarEventUrl: order.calendarEventUrl,
    EventOwnerEmail: order.eventOwnerEmail,
    SiteId: order.siteId,
    SiteName: order.siteName,
    SiteCode: order.siteCode,
    SiteColour: order.siteColour,
    StartAt: order.startAt,
    EndAt: order.endAt,
    EventDate: order.eventDate,
    DeliveryTime: order.deliveryTime,
    ServiceTime: order.serviceTime,
    ClientCompany: order.clientCompany,
    ServiceType: order.serviceType,
    Pax: order.pax,
    Location: order.location,
    Floor: order.floor,
    HostName: order.hostName,
    Notes: order.notes,
    Dietary: order.dietary,
    ItemsJSON: JSON.stringify(order.items || []),
    QuoteUrl: order.quoteUrl,
    QuoteName: order.quoteName,
    BookingFormUrl: order.bookingFormUrl,
    BookingFormName: order.bookingFormName,
    AttachmentCount: order.attachmentCount,
    Status: order.status,
    WarningsJSON: JSON.stringify(order.warnings || []),
    SourceUpdatedAt: order.sourceUpdatedAt,
    ScannedAt: order.scannedAt,
    RawJSON: JSON.stringify(order.raw || {}),
    ChangesJSON: JSON.stringify(order.changes || []),
    ChangedAt: order.changedAt || "",
    Prepped: order.prepped === true,
    PreppedAt: order.preppedAt || "",
    PreppedBy: order.preppedBy || "",
    PrepPhotoFileId: order.prepPhotoFileId || "",
    PrepPhotoUrl: order.prepPhotoUrl || "",
    PrepPhotoAt: order.prepPhotoAt || "",
    AllergenPhotoFileId: order.allergenPhotoFileId || "",
    AllergenPhotoUrl: order.allergenPhotoUrl || "",
    AllergenPhotoAt: order.allergenPhotoAt || "",
    PrepPhotosJSON: JSON.stringify(order.prepPhotos || []),
    AllergenPhotosJSON: JSON.stringify(order.allergenPhotos || [])
  };
  return CPU_CONFIG.ORDER_HEADERS.map(function(header) { return valueByHeader[header] || ""; });
}

function getCpuOrderChanges_(existingRow, order, headers) {
  const index = {};
  headers.forEach(function(header, position) { index[header] = position; });
  const changes = [];
  const add = function(label, before, after) {
    const oldValue = String(before == null ? "" : before).trim();
    const newValue = String(after == null ? "" : after).trim();
    if (oldValue !== newValue) changes.push(label + ": " + (oldValue || "not set") + " → " + (newValue || "not set"));
  };
  add("Date", cpuSheetDate_(existingRow[index.EventDate]), order.eventDate);
  add("Delivery", cpuSheetTime_(existingRow[index.DeliveryTime]), order.deliveryTime);
  add("Service", cpuSheetTime_(existingRow[index.ServiceTime]), order.serviceTime);
  add("Pax", Number(existingRow[index.Pax]) || 0, Number(order.pax) || 0);
  add("Service type", existingRow[index.ServiceType], order.serviceType);
  add("Location", existingRow[index.Location], order.location);
  add("Floor / room", existingRow[index.Floor], order.floor);
  add("Dietary", existingRow[index.Dietary], order.dietary);
  add("Chef notes", existingRow[index.Notes], order.notes);

  const beforeItems = cpuJson_(existingRow[index.ItemsJSON], [])
    .map(function(item) { return (Number(item.quantity) || 0) + "× " + String(item.name || "").trim(); })
    .sort().join(" | ");
  const afterItems = (order.items || [])
    .map(function(item) { return (Number(item.quantity) || 0) + "× " + String(item.name || "").trim(); })
    .sort().join(" | ");
  add("Products", beforeItems, afterItems);
  return changes;
}

function getCpuOrderSourceMap_() {
  const sheet = ensureCpuOrdersSheet_();
  if (sheet.getLastRow() < 2) return {};
  const map = getCpuHeaderMap_(sheet);
  const rowCount = sheet.getLastRow() - 1;
  const keys = sheet.getRange(2, map.OrderKey, rowCount, 1).getDisplayValues();
  const updated = sheet.getRange(2, map.SourceUpdatedAt, rowCount, 1).getValues();
  const result = {};
  keys.forEach(function(row, index) {
    const key = String(row[0] || "").trim();
    if (key) result[key] = cpuSheetIso_(updated[index][0]).trim();
  });
  return result;
}

function upsertCpuDeliveries_(deliveries) {
  if (!deliveries || !deliveries.length) return 0;
  const sheet = ensureCpuDeliveriesSheet_();
  const headers = CPU_CONFIG.DELIVERY_HEADERS;
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    : [];
  const byKey = {};
  rows.forEach(function(row, index) { byKey[String(row[0])] = index + 2; });
  const additions = [];
  deliveries.forEach(function(delivery) {
    const values = headers.map(function(header) {
      const map = {
        DeliveryKey: delivery.deliveryKey, CalendarId: delivery.calendarId,
        CalendarEventId: delivery.calendarEventId, CalendarEventUrl: delivery.calendarEventUrl,
        EventDate: delivery.eventDate, StartAt: delivery.startAt, EndAt: delivery.endAt,
        Summary: delivery.summary, Description: delivery.description, Location: delivery.location,
        SiteId: delivery.siteId, SiteName: delivery.siteName, SiteCode: delivery.siteCode,
        SiteColour: delivery.siteColour, EventOwnerEmail: delivery.eventOwnerEmail,
        SourceUpdatedAt: delivery.sourceUpdatedAt, ScannedAt: delivery.scannedAt,
        DriverEmail: delivery.driverEmail, DriverName: delivery.driverName,
        DriverColour: delivery.driverColour
      };
      return map[header] || "";
    });
    if (byKey[delivery.deliveryKey]) {
      sheet.getRange(byKey[delivery.deliveryKey], 1, 1, headers.length).setValues([values]);
    } else additions.push(values);
  });
  if (additions.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, additions.length, headers.length).setValues(additions);
  }
  bumpCpuDataVersion_();
  return deliveries.length;
}

function getCpuDeliveries_(rangeStart, rangeEnd) {
  const sheet = ensureCpuDeliveriesSheet_();
  if (sheet.getLastRow() < 2) return [];
  const headers = CPU_CONFIG.DELIVERY_HEADERS;
  const map = {};
  headers.forEach(function(header, index) { map[header] = index; });
  const start = normaliseCpuRangeDate_(rangeStart, "0000-00-00");
  const end = normaliseCpuRangeDate_(rangeEnd, "9999-99-99");
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(function(row) {
      const date = cpuSheetDate_(row[map.EventDate]);
      return date >= start && date <= end;
    }).map(function(row) {
      return {
        id: String(row[map.DeliveryKey] || ""),
        eventUrl: String(row[map.CalendarEventUrl] || ""),
        eventDate: cpuSheetDate_(row[map.EventDate]),
        startAt: cpuSheetIso_(row[map.StartAt]),
        endAt: cpuSheetIso_(row[map.EndAt]),
        summary: String(row[map.Summary] || ""),
        description: String(row[map.Description] || ""),
        location: String(row[map.Location] || ""),
        siteId: String(row[map.SiteId] || ""),
        siteName: String(row[map.SiteName] || ""),
        siteCode: String(row[map.SiteCode] || ""),
        siteColour: String(row[map.SiteColour] || ""),
        driverEmail: map.DriverEmail ? String(row[map.DriverEmail] || "") : "",
        driverName: map.DriverName ? String(row[map.DriverName] || "") : "",
        driverColour: map.DriverColour ? String(row[map.DriverColour] || "") : ""
      };
    });
}

function getCpuOrders_(rangeStart, rangeEnd) {
  const sheet = ensureCpuOrdersSheet_();
  if (sheet.getLastRow() < 2) return [];

  const headers = CPU_CONFIG.ORDER_HEADERS;
  const map = {};
  headers.forEach(function(header, index) { map[header] = index; });
  const start = normaliseCpuRangeDate_(rangeStart, "0000-00-00");
  const end = normaliseCpuRangeDate_(rangeEnd, "9999-99-99");

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues()
    .filter(function(row) {
      const date = cpuSheetDate_(row[map.EventDate]);
      return date >= start && date <= end && row[map.Status] !== CPU_CONFIG.STATUS.CANCELLED;
    })
    .map(function(row) {
      const raw = cpuJson_(row[map.RawJSON], {});
      const eventOwnerEmail = (
        (map.EventOwnerEmail ? String(row[map.EventOwnerEmail] || "") : "") ||
        String(((raw.creator || {}).email || (raw.organizer || {}).email || ""))
      ).trim().toLowerCase();
      const ownerSite = getCpuSiteByOwnerEmail_(eventOwnerEmail);
      return sanitiseCpuOrderData_({
        id: row[map.OrderKey],
        calendarId: row[map.CalendarId],
        eventId: row[map.CalendarEventId],
        eventUrl: row[map.CalendarEventUrl],
        eventOwnerEmail: eventOwnerEmail,
        siteId: ownerSite ? ownerSite.id : String(row[map.SiteId] || ""),
        siteName: ownerSite ? ownerSite.name : String(row[map.SiteName] || ""),
        siteCode: ownerSite ? ownerSite.code : String(row[map.SiteCode] || ""),
        siteColour: ownerSite ? ownerSite.colour : String(row[map.SiteColour] || ""),
        startAt: cpuSheetIso_(row[map.StartAt]),
        endAt: cpuSheetIso_(row[map.EndAt]),
        eventDate: cpuSheetDate_(row[map.EventDate]),
        deliveryTime: cpuSheetTime_(row[map.DeliveryTime]),
        serviceTime: cpuSheetTime_(row[map.ServiceTime]),
        clientCompany: String(row[map.ClientCompany] || ""),
        serviceType: String(row[map.ServiceType] || ""),
        pax: Number(row[map.Pax]) || 0,
        location: String(row[map.Location] || ""),
        floor: String(row[map.Floor] || ""),
        hostName: String(row[map.HostName] || ""),
        notes: String(row[map.Notes] || ""),
        dietary: String(row[map.Dietary] || ""),
        items: cpuJson_(row[map.ItemsJSON], []),
        quoteUrl: String(row[map.QuoteUrl] || ""),
        quoteName: String(row[map.QuoteName] || ""),
        bookingFormUrl: String(row[map.BookingFormUrl] || ""),
        bookingFormName: String(row[map.BookingFormName] || ""),
        status: String(row[map.Status] || ""),
        warnings: cpuJson_(row[map.WarningsJSON], []),
        changes: map.ChangesJSON ? cpuJson_(row[map.ChangesJSON], []) : [],
        changedAt: map.ChangedAt ? cpuSheetIso_(row[map.ChangedAt]) : "",
        prepped: map.Prepped ? cpuSheetBoolean_(row[map.Prepped]) : false,
        preppedAt: map.PreppedAt ? cpuSheetIso_(row[map.PreppedAt]) : "",
        preppedBy: map.PreppedBy ? String(row[map.PreppedBy] || "") : "",
        prepPhotoFileId: map.PrepPhotoFileId ? String(row[map.PrepPhotoFileId] || "") : "",
        prepPhotoUrl: map.PrepPhotoUrl ? String(row[map.PrepPhotoUrl] || "") : "",
        prepPhotoAt: map.PrepPhotoAt ? cpuSheetIso_(row[map.PrepPhotoAt]) : "",
        allergenPhotoFileId: map.AllergenPhotoFileId ? String(row[map.AllergenPhotoFileId] || "") : "",
        allergenPhotoUrl: map.AllergenPhotoUrl ? String(row[map.AllergenPhotoUrl] || "") : "",
        allergenPhotoAt: map.AllergenPhotoAt ? cpuSheetIso_(row[map.AllergenPhotoAt]) : "",
        prepPhotos: map.PrepPhotosJSON ? cpuJson_(row[map.PrepPhotosJSON], []) : [],
        allergenPhotos: map.AllergenPhotosJSON ? cpuJson_(row[map.AllergenPhotosJSON], []) : [],
        scannedAt: cpuSheetIso_(row[map.ScannedAt])
      });
    });
}

function normaliseCpuRangeDate_(value, fallback) {
  if (!value) return fallback;
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  if (typeof value === "number" && value > 0) {
    return Utilities.formatDate(
      new Date(Date.UTC(1899, 11, 30) + value * 86400000),
      "UTC",
      "yyyy-MM-dd"
    );
  }
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : fallback;
}

function cpuJson_(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (error) { return fallback; }
}

function cpuSheetDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  if (typeof value === "number" && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
  }
  return String(value || "").slice(0, 10);
}

function cpuSheetIso_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function cpuSheetBoolean_(value) {
  if (value === true || value === 1) return true;
  return /^(true|yes|y|1|done|prepped)$/i.test(String(value || "").trim());
}

function cpuSheetTime_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }
  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2);
  }
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? ("0" + Number(match[1])).slice(-2) + ":" + match[2] : text;
}

function updateCpuOrder_(orderKey, patch) {
  const sheet = ensureCpuOrdersSheet_();
  const headers = CPU_CONFIG.ORDER_HEADERS;
  const map = getCpuHeaderMap_(sheet);
  if (sheet.getLastRow() < 2) throw new Error("No CPU orders are available.");

  const keys = sheet.getRange(2, map.OrderKey, sheet.getLastRow() - 1, 1).getDisplayValues();
  let rowNumber = 0;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(orderKey)) {
      rowNumber = i + 2;
      break;
    }
  }
  if (!rowNumber) throw new Error("Order not found.");

  const allowed = {
    EventDate: "eventDate",
    DeliveryTime: "deliveryTime",
    ServiceTime: "serviceTime",
    Pax: "pax",
    Location: "location",
    Floor: "floor",
    HostName: "hostName",
    Notes: "notes",
    Dietary: "dietary"
  };

  Object.keys(allowed).forEach(function(header) {
    const property = allowed[header];
    if (!Object.prototype.hasOwnProperty.call(patch, property) || !map[header]) return;
    let value = patch[property];
    if (property === "pax") value = Number(value) || 0;
    sheet.getRange(rowNumber, map[header]).setValue(value);
  });

  if (Object.prototype.hasOwnProperty.call(patch, "items") && map.ItemsJSON) {
    const items = (Array.isArray(patch.items) ? patch.items : [])
      .map(function(item) {
        return {
          name: String(item.name || "").trim(),
          quantity: Number(item.quantity) || 0,
          notes: String(item.notes || "").trim()
        };
      })
      .filter(function(item) { return item.name; });
    sheet.getRange(rowNumber, map.ItemsJSON).setValue(JSON.stringify(items));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "warnings") && map.WarningsJSON) {
    const warnings = (Array.isArray(patch.warnings) ? patch.warnings : [])
      .map(function(warning) { return String(warning || "").trim(); })
      .filter(Boolean);
    sheet.getRange(rowNumber, map.WarningsJSON).setValue(JSON.stringify(warnings));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "status") && map.Status) {
    const status = String(patch.status || "").trim();
    if (status === CPU_CONFIG.STATUS.READY ||
        status === CPU_CONFIG.STATUS.NEEDS_ATTENTION ||
        status === CPU_CONFIG.STATUS.CANCELLED) {
      sheet.getRange(rowNumber, map.Status).setValue(status);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "prepped") && map.Prepped) {
    const prepped = patch.prepped === true || String(patch.prepped).toLowerCase() === "true";
    sheet.getRange(rowNumber, map.Prepped).setValue(prepped);
    if (map.PreppedAt) {
      sheet.getRange(rowNumber, map.PreppedAt).setValue(prepped ? new Date() : "");
    }
    if (map.PreppedBy) {
      sheet.getRange(rowNumber, map.PreppedBy).setValue(prepped ? String(patch.preppedBy || "").trim() : "");
    }
  } else if (Object.prototype.hasOwnProperty.call(patch, "preppedBy") && map.PreppedBy) {
    sheet.getRange(rowNumber, map.PreppedBy).setValue(String(patch.preppedBy || "").trim());
  }

  if (Object.prototype.hasOwnProperty.call(patch, "prepPhotoFileId") && map.PrepPhotoFileId) {
    sheet.getRange(rowNumber, map.PrepPhotoFileId).setValue(String(patch.prepPhotoFileId || "").trim());
  }
  if (Object.prototype.hasOwnProperty.call(patch, "prepPhotoUrl") && map.PrepPhotoUrl) {
    sheet.getRange(rowNumber, map.PrepPhotoUrl).setValue(String(patch.prepPhotoUrl || "").trim());
  }
  if (Object.prototype.hasOwnProperty.call(patch, "prepPhotoAt") && map.PrepPhotoAt) {
    sheet.getRange(rowNumber, map.PrepPhotoAt).setValue(patch.prepPhotoAt ? new Date(patch.prepPhotoAt) : "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "allergenPhotoFileId") && map.AllergenPhotoFileId) {
    sheet.getRange(rowNumber, map.AllergenPhotoFileId).setValue(String(patch.allergenPhotoFileId || "").trim());
  }
  if (Object.prototype.hasOwnProperty.call(patch, "allergenPhotoUrl") && map.AllergenPhotoUrl) {
    sheet.getRange(rowNumber, map.AllergenPhotoUrl).setValue(String(patch.allergenPhotoUrl || "").trim());
  }
  if (Object.prototype.hasOwnProperty.call(patch, "allergenPhotoAt") && map.AllergenPhotoAt) {
    sheet.getRange(rowNumber, map.AllergenPhotoAt).setValue(patch.allergenPhotoAt ? new Date(patch.allergenPhotoAt) : "");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "prepPhotos") && map.PrepPhotosJSON) {
    sheet.getRange(rowNumber, map.PrepPhotosJSON).setValue(JSON.stringify(Array.isArray(patch.prepPhotos) ? patch.prepPhotos : []));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "allergenPhotos") && map.AllergenPhotosJSON) {
    sheet.getRange(rowNumber, map.AllergenPhotosJSON).setValue(JSON.stringify(Array.isArray(patch.allergenPhotos) ? patch.allergenPhotos : []));
  }

  if (map.ScannedAt) sheet.getRange(rowNumber, map.ScannedAt).setValue(new Date());
  bumpCpuDataVersion_();
  return { ok: true, orderKey: orderKey };
}

function getCpuDataVersion_() {
  return PropertiesService.getScriptProperties().getProperty("CPU_DATA_VERSION") || "1";
}

function bumpCpuDataVersion_() {
  const properties = PropertiesService.getScriptProperties();
  const next = Number(properties.getProperty("CPU_DATA_VERSION") || 1) + 1;
  properties.setProperty("CPU_DATA_VERSION", String(next));
  return String(next);
}
