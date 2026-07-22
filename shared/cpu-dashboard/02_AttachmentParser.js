function parseCpuEvent_(event, sourceCalendar) {
  const attachments = mergeCpuAttachments_(
    event.attachments || [],
    extractCpuDescriptionAttachments_(event.description || "")
  );
  const classified = classifyCpuAttachments_(attachments);
  const titleData = parseCpuCalendarTitle_(event.summary || "");
  const jsonData = classified.json
    ? readCpuBookingJsonAttachment_(classified.json)
    : { data: {}, warnings: [] };
  const quoteData = classified.quote
    ? readCpuQuoteAttachment_(classified.quote)
    : { data: {}, warnings: ["Quote attachment missing"] };
  const formData = classified.form
    ? readCpuBookingFormAttachment_(classified.form)
    : { data: {}, warnings: [] };

  const startAt = new Date((event.start || {}).dateTime || (event.start || {}).date);
  const endAt = new Date((event.end || {}).dateTime || (event.end || {}).date);
  const merged = mergeCpuBookingData_(jsonData.data, quoteData.data, formData.data, titleData);
  const eventOwnerEmail = String(
    (event.creator || {}).email || (event.organizer || {}).email || ""
  ).trim().toLowerCase();
  const site = resolveCpuSite_(
    merged.location || event.location || titleData.siteCode || sourceCalendar.defaultSiteName,
    sourceCalendar,
    eventOwnerEmail
  );
  const warnings = []
    .concat(jsonData.warnings || [])
    .concat(quoteData.warnings || [])
    .concat(formData.warnings || []);

  if (!merged.pax) warnings.push("Pax could not be read");
  if (!merged.items.length) warnings.push("No menu items could be read");

  return {
    orderKey: sourceCalendar.id + "::" + event.id,
    calendarId: sourceCalendar.id,
    calendarEventId: event.id || "",
    calendarEventUrl: event.htmlLink || "",
    eventOwnerEmail: eventOwnerEmail,
    siteId: site.id,
    siteName: site.name,
    siteCode: site.code,
    siteColour: site.colour,
    startAt: cpuIso_(startAt),
    endAt: cpuIso_(endAt),
    eventDate: Utilities.formatDate(startAt, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    deliveryTime: merged.deliveryTime || Utilities.formatDate(startAt, Session.getScriptTimeZone(), "HH:mm"),
    serviceTime: merged.serviceTime || "",
    clientCompany: merged.clientCompany || titleData.clientCompany || event.summary || "Untitled booking",
    serviceType: merged.serviceType || titleData.serviceType || "Hospitality",
    pax: Number(merged.pax) || 0,
    location: merged.location || event.location || site.name,
    floor: merged.floor || "",
    hostName: merged.hostName || "",
    notes: merged.notes || cpuCleanHtmlText_(event.description || ""),
    dietary: merged.dietary || "",
    items: merged.items,
    quoteUrl: classified.quote ? classified.quote.fileUrl || "" : "",
    quoteName: classified.quote ? classified.quote.title || "Quote" : "",
    bookingFormUrl: classified.json
      ? classified.json.fileUrl || ""
      : classified.form ? classified.form.fileUrl || "" : "",
    bookingFormName: classified.json
      ? classified.json.title || "Booking JSON"
      : classified.form ? classified.form.title || "Booking form" : "",
    attachmentCount: attachments.length,
    status: event.status === "cancelled"
      ? CPU_CONFIG.STATUS.CANCELLED
      : warnings.length ? CPU_CONFIG.STATUS.NEEDS_ATTENTION : CPU_CONFIG.STATUS.READY,
    warnings: uniqueCpuStrings_(warnings),
    sourceUpdatedAt: getCpuEventSourceVersion_(event),
    scannedAt: new Date().toISOString(),
    raw: {
      summary: event.summary || "",
      description: event.description || "",
      creator: event.creator || {},
      organizer: event.organizer || {},
      attachments: attachments
    }
  };
}

function classifyCpuAttachments_(attachments) {
  const values = attachments || [];
  const rankedJson = values
    .map(function(attachment) {
      return { attachment: attachment, score: cpuJsonAttachmentScore_(attachment) };
    })
    .sort(function(a, b) { return b.score - a.score; });
  const rankedQuotes = values
    .map(function(attachment) {
      return { attachment: attachment, score: cpuQuoteAttachmentScore_(attachment) };
    })
    .sort(function(a, b) { return b.score - a.score; });
  const rankedForms = values
    .map(function(attachment) {
      return { attachment: attachment, score: cpuFormAttachmentScore_(attachment) };
    })
    .sort(function(a, b) { return b.score - a.score; });

  const quote = rankedQuotes.length && rankedQuotes[0].score > 0
    ? rankedQuotes[0].attachment
    : values[0] || null;
  const formCandidate = rankedForms.filter(function(item) {
    return item.score > 0 && (!quote || cpuAttachmentKey_(item.attachment) !== cpuAttachmentKey_(quote));
  })[0];
  const form = formCandidate ? formCandidate.attachment : null;
  const json = rankedJson.length && rankedJson[0].score > 0
    ? rankedJson[0].attachment
    : null;
  return { quote: quote, form: form, json: json };
}

function readCpuBookingJsonAttachment_(attachment) {
  const id = attachment.fileId || extractCpuDriveId_(attachment.fileUrl || "");
  if (!id) return { data: {}, warnings: ["Booking JSON link is unreadable"] };

  try {
    const file = DriveApp.getFileById(id);
    const parsed = JSON.parse(file.getBlob().getDataAsString("UTF-8"));
    return {
      data: normaliseCpuBookingJson_(parsed),
      warnings: []
    };
  } catch (error) {
    return { data: {}, warnings: [cpuFileReadWarning_("Booking JSON", error)] };
  }
}

function normaliseCpuBookingJson_(booking) {
  booking = booking || {};
  const clientBooking = booking.clientBooking || {};
  const client = clientBooking.client || {};
  const event = clientBooking.event || {};
  const dietaries = clientBooking.dietaries || {};
  const serviceTimes = Array.isArray(booking.serviceTimes) ? booking.serviceTimes : [];
  const sourceItems = Array.isArray(booking.items)
    ? booking.items
    : clientBooking.order && Array.isArray(clientBooking.order.items)
      ? clientBooking.order.items
      : [];

  return {
    clientCompany: booking.clientCompany || client.companyName || "",
    hostName: booking.hostName || client.name || "",
    invoiceReference: booking.invoiceReference || client.invoiceReference || "",
    pax: Number(booking.pax || event.guestCount || 0),
    serviceType: booking.serviceType || (clientBooking.order || {}).eventType || "",
    deliveryTime: serviceTimes[0] || event.startTime || "",
    serviceTime: serviceTimes[0] || event.startTime || "",
    location: booking.location || event.roomOrArea || event.deliveryPoint || "",
    floor: booking.floor || event.floorLevel || "",
    notes: booking.notes || clientBooking.specialInstructions || "",
    dietary: buildCpuDietaryFromJson_(dietaries),
    items: sourceItems.map(function(item) {
      return {
        name: item.name || item.itemName || "",
        quantity: Number(item.qty || item.quantity || 0),
        notes: [
          item.detail || "",
          item.info || item.servingInfo || "",
          item.comment || item.comments || ""
        ].filter(Boolean).join(" · ")
      };
    }).filter(function(item) {
      return item.name && item.quantity > 0;
    })
  };
}

function buildCpuDietaryFromJson_(dietaries) {
  if (!dietaries || !Object.keys(dietaries).length) return "";
  return [
    dietaries.vegetarian ? "Vegetarian " + dietaries.vegetarian : "",
    dietaries.vegan ? "Vegan " + dietaries.vegan : "",
    dietaries.glutenFree ? "Gluten-free " + dietaries.glutenFree : "",
    dietaries.coeliac ? "Coeliac " + dietaries.coeliac : "",
    dietaries.dairyFree ? "Dairy-free " + dietaries.dairyFree : "",
    dietaries.halal ? "Halal " + dietaries.halal : "",
    dietaries.otherCount ? "Other " + dietaries.otherCount : "",
    dietaries.allergyDetails ? "Allergies: " + dietaries.allergyDetails : "",
    dietaries.freeText || ""
  ].filter(Boolean).join(" · ");
}

function readCpuQuoteAttachment_(attachment) {
  const id = attachment.fileId || extractCpuDriveId_(attachment.fileUrl || "");
  if (!id) return { data: {}, warnings: ["Quote attachment link is unreadable"] };

  try {
    const file = DriveApp.getFileById(id);
    const mime = file.getMimeType();
    let text = "";

    if (mime === MimeType.GOOGLE_DOCS) {
      text = DocumentApp.openById(id).getBody().getText();
    } else if (mime === MimeType.GOOGLE_SHEETS || isCpuSpreadsheet_(mime, file.getName())) {
      return { data: readCpuSpreadsheetFile_(file), warnings: [] };
    } else if (mime === MimeType.GOOGLE_SLIDES || isCpuPresentation_(mime, file.getName())) {
      return { data: parseCpuTextFields_(readCpuPresentationText_(file)), warnings: [] };
    } else if (mime === MimeType.PLAIN_TEXT || mime === MimeType.CSV) {
      text = file.getBlob().getDataAsString();
    } else if (isCpuWordDocument_(mime, file.getName())) {
      const directDocxText = readCpuDocxXmlText_(file);
      const converted = createCpuConvertedFile_(file, MimeType.GOOGLE_DOCS, "CPU temporary quote parse - ");
      try {
        const convertedText = DocumentApp.openById(converted.id).getBody().getText();
        text = mergeCpuDocumentText_(convertedText, directDocxText);
      } finally {
        try { DriveApp.getFileById(converted.id).setTrashed(true); } catch (ignore) {}
      }
    } else {
      return { data: {}, warnings: ["Quote format cannot be read automatically: " + mime] };
    }

    return {
      data: parseCpuTextFields_(text),
      warnings: [],
      diagnostic: {
        charactersRead: String(text || "").length,
        sourceType: mime,
        excerpt: cpuParserDiagnosticExcerpt_(text)
      }
    };
  } catch (error) {
    return { data: {}, warnings: [cpuFileReadWarning_("Quote", error)] };
  }
}

function readCpuBookingFormAttachment_(attachment) {
  const id = attachment.fileId || extractCpuDriveId_(attachment.fileUrl || "");
  if (!id) return { data: {}, warnings: ["Booking form link is unreadable"] };

  let temporaryId = "";
  try {
    const file = DriveApp.getFileById(id);
    const mime = file.getMimeType();
    let spreadsheetId = id;

    if (mime !== MimeType.GOOGLE_SHEETS) {
      const converted = createCpuConvertedFile_(file, MimeType.GOOGLE_SHEETS, "CPU temporary parse - ");
      spreadsheetId = converted.id;
      temporaryId = spreadsheetId;
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const parsed = parseCpuSpreadsheet_(spreadsheet);
    return { data: parsed, warnings: [] };
  } catch (error) {
    return { data: {}, warnings: [cpuFileReadWarning_("Booking form", error)] };
  } finally {
    if (temporaryId) {
      try { DriveApp.getFileById(temporaryId).setTrashed(true); } catch (ignore) {}
    }
  }
}

function parseCpuSpreadsheet_(spreadsheet) {
  const result = { items: [] };
  const lines = [];

  spreadsheet.getSheets().forEach(function(sheet) {
    const range = sheet.getDataRange();
    if (range.getNumRows() > 250 || range.getNumColumns() > 40) return;
    const values = range.getDisplayValues();
    values.forEach(function(row) {
      const clean = row.map(cpuCleanText_).filter(Boolean);
      if (clean.length) lines.push(clean);
    });
  });

  const flatText = lines.map(function(row) { return row.join(" | "); }).join("\n");
  Object.assign(result, parseCpuTextFields_(flatText));
  result.items = extractCpuItemsFromRows_(lines);
  return result;
}

function parseCpuTextFields_(text) {
  const source = cpuCleanText_(text);
  const pax = cpuParseNumber_(cpuMatchField_(source, ["pax", "number", "guests", "covers", "people"]));
  const items = extractCpuItemsFromText_(source).concat(
    extractCpuPerPersonPackageItems_(source, pax)
  );
  const result = {
    clientCompany: cpuMatchField_(source, ["company", "client", "organisation"]),
    hostName: cpuMatchField_(source, ["host", "contact"]),
    pax: pax,
    serviceType: cpuMatchField_(source, ["service type"]),
    deliveryTime: cpuNormaliseTime_(cpuMatchField_(source, ["delivery time", "arrival time"])),
    serviceTime: cpuNormaliseTime_(cpuMatchField_(source, ["service time", "event time"])),
    location: cpuMatchField_(source, ["location", "site"]),
    floor: cpuMatchField_(source, ["floor", "room"]),
    notes: cpuMatchField_(source, ["notes", "special instructions", "instructions"]),
    dietary: cpuMatchField_(source, ["dietary requirements", "dietary", "allergens", "allergies"]),
    items: dedupeCpuItems_(items)
  };
  return sanitiseCpuParsedData_(result, source);
}

function extractCpuPerPersonPackageItems_(text, pax) {
  if (!pax) return [];
  const source = normaliseCpuProductSourceText_(text);
  const items = [];
  const pattern = /(?:^|\n)\s*([a-z][^\n£]{2,100}?)\s+(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?\s*(?:p\s*\/?\s*p|pp)\b(?:\s*[-–—=]\s*(?:£|gbp)\s*\d[\d,]*(?:[.,]\d{1,2})?)?/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const name = cleanCpuProductName_(match[1]);
    if (isCpuPricedMenuItemName_(name)) {
      items.push({
        quantity: Number(pax),
        name: name,
        notes: "",
        kind: "priced"
      });
    }
  }
  return items;
}

function parseCpuCalendarTitle_(title) {
  const value = cpuCleanText_(title);
  const match = value.match(/^([^_]+)_([^_]+)_([^x]+)\s+x\s*(\d+)/i);
  if (match) {
    return {
      siteCode: match[1].trim(),
      clientCompany: match[2].trim(),
      serviceType: match[3].trim(),
      pax: Number(match[4])
    };
  }

  const paxMatch = value.match(/(?:qty\s*)?[x×]\s*(\d+)\b/i);
  const parts = value.split("_").map(cpuCleanText_).filter(Boolean);
  return {
    siteCode: parts.length > 2 ? parts[0] : "",
    clientCompany: parts.length > 2 ? parts[1] : value.replace(/\s*(?:qty\s*)?[x×]\s*\d+.*$/i, "").trim(),
    serviceType: parts.length > 2 ? parts.slice(2).join(" ").replace(/\s*(?:qty\s*)?[x×]\s*\d+.*$/i, "").trim() : "",
    pax: paxMatch ? Number(paxMatch[1]) : 0
  };
}

function mergeCpuBookingData_() {
  const sources = Array.prototype.slice.call(arguments);
  const result = { items: [] };
  const fields = [
    "clientCompany", "hostName", "pax", "serviceType", "deliveryTime",
    "serviceTime", "location", "floor", "notes", "dietary"
  ];
  fields.forEach(function(field) {
    for (let i = 0; i < sources.length; i++) {
      if (sources[i] && isCpuUsefulField_(field, sources[i][field])) {
        result[field] = sources[i][field];
        break;
      }
    }
  });
  for (let i = 0; i < sources.length; i++) {
    if (sources[i] && Array.isArray(sources[i].items) && sources[i].items.length) {
      result.items = sources[i].items;
      break;
    }
  }
  return result;
}

function extractCpuItemsFromRows_(rows) {
  const items = [];
  rows.forEach(function(row) {
    if (row.length < 2) return;
    let quantity = 0;
    let name = "";
    for (let i = 0; i < row.length; i++) {
      const numeric = cpuParseNumber_(row[i]);
      if (!quantity && numeric > 0 && numeric < 10000) quantity = numeric;
      else if (!name && String(row[i]).length > 2 && !String(row[i]).match(/^(item|menu|qty|quantity|price|total)$/i)) {
        name = String(row[i]);
      }
    }
    if (quantity && name && isCpuMenuItemName_(name)) {
      items.push({ name: name, quantity: quantity, notes: row.slice(2).join(" · ") });
    }
  });
  return dedupeCpuItems_(items).slice(0, 80);
}

function extractCpuItemsFromText_(text) {
  const items = [];
  const source = normaliseCpuProductSourceText_(text);
  const pricedPattern = /(?:^|\n)\s*(\d+)\s*[x×]\s*([^\n£=]{3,140}?)(?:\s*[-–—]\s*)?£\s*\d+(?:\.\d{1,2})?(?:\s*p\/p)?(?:\s*=\s*£\s*\d+(?:\.\d{1,2})?)?/gi;
  let pricedMatch;
  while ((pricedMatch = pricedPattern.exec(source))) {
    const name = cleanCpuProductName_(pricedMatch[2]);
    if (isCpuPricedMenuItemName_(name)) {
      items.push({
        quantity: Number(pricedMatch[1]),
        name: name,
        notes: "",
        kind: "priced"
      });
    }
  }
  // Some Word templates place the section heading and priced product in the
  // same paragraph: "12:30pm - Lunch 10x Salad & Protein - £14.00...".
  // Requiring a following price prevents metadata such as "Number: 10x" from
  // being mistaken for an order line.
  const embeddedPricedPattern = /(\d+)\s*[x×]\s*([a-z][^\n£=]{2,140}?)\s*[-–—]\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?(?:\s*p\s*\/?\s*p)?(?:\s*=\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?)?/gi;
  let embeddedPricedMatch;
  while ((embeddedPricedMatch = embeddedPricedPattern.exec(source))) {
    const name = cleanCpuProductName_(embeddedPricedMatch[2]);
    if (isCpuPricedMenuItemName_(name)) {
      items.push({
        quantity: Number(embeddedPricedMatch[1]),
        name: name,
        notes: "",
        kind: "priced"
      });
    }
  }
  // Some quotes put the product heading on one line and the quantity in a
  // price calculation immediately below it:
  // "Sandwich Lunch\n£7.00 p/p x 22 = £154.00".
  const headingPricePattern = /(?:^|\n)\s*([a-z][^\n£]{2,100}?)\s*\n\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?\s*p\s*\/?\s*p\s*[x×]\s*(\d+)\s*(?:=\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?)?/gi;
  let headingPriceMatch;
  while ((headingPriceMatch = headingPricePattern.exec(source))) {
    const name = cleanCpuProductName_(headingPriceMatch[1]);
    if (isCpuPricedMenuItemName_(name)) {
      items.push({
        quantity: Number(headingPriceMatch[2]),
        name: name,
        notes: "",
        kind: "priced"
      });
    }
  }
  const packagePattern = /(?:^|\n)\s*(?!(?:number|pax|guests?|covers?|people)\s*:?\s*)(?:\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?(?:\s*[-–—]\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?)?\s*[-–—:]\s*)?(\d+)\s*[x×]\s*([a-z][^\n]{2,160})/gi;
  let packageMatch;
  while ((packageMatch = packagePattern.exec(source))) {
    const name = cleanCpuProductName_(packageMatch[2]);
    if (isCpuQuantityMenuItemName_(name)) {
      items.push({
        quantity: Number(packageMatch[1]),
        name: name,
        notes: "",
        kind: "quantity"
      });
    }
  }
  source.split(/\n/).forEach(function(line) {
    const timedLeadingQuantity = line.match(
      /^\s*(?:\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*[-–—:]\s*)?(\d+)\s*[x×]\s+(.{3,140})$/i
    );
    const prefixedQuantity = line.match(/^\s*[x×]\s*(\d+)\s+(.{3,160})$/i);
    const leadingQuantity = line.match(/^\s*(\d+)\s*[x×-]?\s+(.{3,100})$/i);
    const trailingQuantity = line.match(/^\s*(?:\d{1,2}:\d{2}\s*-\s*)?(.{3,100}?)\s+[x×]\s*(\d+)\s*$/i);
    if (timedLeadingQuantity && isCpuQuantityMenuItemName_(timedLeadingQuantity[2])) {
      items.push({
        quantity: Number(timedLeadingQuantity[1]),
        name: timedLeadingQuantity[2].trim(),
        notes: "",
        kind: "quantity"
      });
    } else if (prefixedQuantity) {
      const servedCount = prefixedQuantity[2].match(/\(\s*for\s+(\d+)\s+people\b/i);
      const name = cleanCpuProductName_(prefixedQuantity[2]);
      if (isCpuQuantityMenuItemName_(name)) {
        items.push({
          quantity: servedCount ? Number(servedCount[1]) : Number(prefixedQuantity[1]),
          name: name,
          notes: servedCount
            ? Number(prefixedQuantity[1]) + " platter / serves " + Number(servedCount[1])
            : "",
          kind: "quantity"
        });
      }
    } else if (leadingQuantity && isCpuQuantityMenuItemName_(leadingQuantity[2])) {
      items.push({ quantity: Number(leadingQuantity[1]), name: leadingQuantity[2].trim(), notes: "", kind: "quantity" });
    } else if (trailingQuantity && isCpuQuantityMenuItemName_(trailingQuantity[1])) {
      items.push({ quantity: Number(trailingQuantity[2]), name: trailingQuantity[1].trim(), notes: "", kind: "quantity" });
    }
  });
  return dedupeCpuItems_(items);
}

function isCpuMenuItemName_(value) {
  const name = String(value || "").trim();
  return Boolean(name) &&
    !name.match(/^(number|pax|guest|guests|cover|covers|people)\s*:?$/i) &&
    !name.match(/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{2,4}$/i) &&
    !name.match(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+\d.*)?$/i) &&
    !name.match(/(order total|total net|total gross|vat|management fee|price)/i) &&
    !isCpuDietaryLine_(name) &&
    !isCpuCommentLine_(name) &&
    !isCpuBoilerplateLine_(name);
}

function isCpuPricedMenuItemName_(value) {
  const name = String(value || "").trim();
  return Boolean(name) &&
    !name.match(/^(number|pax|guest|guests|cover|covers|people|dietary requirements?|allergens?|allergies|notes?|menu)\s*:?$/i) &&
    !name.match(/(order total|total net|total gross|vat|management fee|delivery charge)/i) &&
    !isCpuCommentLine_(name) &&
    !isCpuBoilerplateLine_(name);
}

function isCpuQuantityMenuItemName_(value) {
  const name = cleanCpuProductName_(value);
  return Boolean(name) &&
    !name.match(/^(number|pax|guest|guests|cover|covers|people|dietary requirements?|allergens?|allergies|notes?|menu)\s*:?$/i) &&
    !name.match(/^(?:gluten|dairy|nut)[- ]?free\b/i) &&
    !name.match(/^(?:veg|vege|veggie|vegan|vegetarian|halal|kosher|coeliac|celiac)\s*$/i) &&
    !name.match(/^(?:allerg(?:y|ies|ic|en|ens)|no|without|exclude|excluding|hold)\b/i) &&
    !name.match(/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{2,4}$/i) &&
    !name.match(/(order total|total net|total gross|vat|management fee|delivery charge)/i) &&
    !isCpuCommentLine_(name) &&
    !isCpuBoilerplateLine_(name);
}

function sanitiseCpuParsedData_(data, sourceText) {
  const result = Object.assign({}, data || {});
  const dietaryLines = [];
  const noteLines = [];
  const cleanItems = [];

  (result.items || []).forEach(function(item) {
    const name = cleanCpuProductName_(item.name);
    const combined = cpuCleanText_([item.quantity ? item.quantity + " " : "", name, item.notes || ""].join(" "));
    if (isCpuBoilerplateLine_(combined)) {
      return;
    } else if (item.kind !== "priced" && item.kind !== "quantity" && isCpuDietaryLine_(combined)) {
      dietaryLines.push(normaliseCpuNoteLine_(combined));
    } else if (isCpuCommentLine_(combined)) {
      noteLines.push(normaliseCpuNoteLine_(combined));
    } else if (item.kind === "priced" || item.kind === "quantity" || isCpuMenuItemName_(name)) {
      cleanItems.push({
        name: name,
        quantity: Number(item.quantity) || 0,
        notes: cpuCleanText_(item.notes || ""),
        kind: item.kind || ""
      });
    }
  });

  const pricedItemNames = cleanItems
    .filter(function(item) { return item.kind === "priced" || item.kind === "quantity"; })
    .map(function(item) { return item.name.toLowerCase(); });
  String(sourceText || "").split(/\n/).forEach(function(line) {
    const clean = cpuCleanText_(line);
    if (!clean) return;
    const lower = clean.toLowerCase();
    if (pricedItemNames.some(function(name) { return lower.indexOf(name) !== -1; })) return;
    if (isCpuBoilerplateLine_(clean)) {
      return;
    } else if (isCpuExplicitDietaryLine_(clean) && !isCpuDietaryHeading_(clean)) {
      const dietaryLine = normaliseCpuNoteLine_(clean);
      if (!/^(?:no|none|n\/a|na|nil)$/i.test(dietaryLine)) dietaryLines.push(dietaryLine);
    } else if (isCpuCommentLine_(clean) && !isCpuBoilerplateLine_(clean)) {
      noteLines.push(normaliseCpuNoteLine_(clean));
    }
  });

  result.items = dedupeCpuItems_(cleanItems);
  const existingDietary = String(result.dietary || "").split(/\n/)
    .map(normaliseCpuNoteLine_)
    .filter(function(value) {
      return Boolean(value) && value !== ":" && !/^(?:no|none|n\/a|na|nil)$/i.test(value);
    });
  const existingNotes = String(result.notes || "").split(/\n/)
    .map(cpuCleanHtmlText_)
    .map(normaliseCpuNoteLine_)
    .filter(function(value) { return value && !isCpuBoilerplateLine_(value); });
  result.dietary = joinCpuNotes_("", existingDietary.concat(dietaryLines));
  result.notes = joinCpuNotes_("", existingNotes.concat(noteLines));
  if (/^(?:requirements?|requirement details?)$/i.test(cpuCleanText_(result.dietary))) result.dietary = "";
  if (/^(?:no|none|n\/a|na|nil)$/i.test(cpuCleanText_(result.dietary))) result.dietary = "";
  if (isCpuBoilerplateLine_(result.dietary)) result.dietary = joinCpuNotes_("", dietaryLines);
  if (isCpuBoilerplateLine_(result.notes)) result.notes = joinCpuNotes_("", noteLines);
  return result;
}

function sanitiseCpuOrderData_(order) {
  const cleaned = sanitiseCpuParsedData_({
    items: order.items || [],
    dietary: order.dietary || "",
    notes: order.notes || ""
  }, "");
  order.items = cleaned.items;
  order.dietary = cleaned.dietary;
  order.notes = cleaned.notes;
  return order;
}

function isCpuDietaryLine_(value) {
  const text = String(value || "").toLowerCase();
  return /\b(allerg(?:y|ies|ic|en|ens)|dietary|coeliac|celiac|gluten[- ]?free|dairy[- ]?free|nut[- ]?free|vegan|vegetarian|halal|kosher|intolerance|shellfish|shrimp|prawn|sesame|soya|soy|lactose)\b/.test(text) ||
    /^\s*(?:\d+\s+)?(?:no|without|exclude|excluding|hold)\s+(?:beef|fish|pork|meat|dairy|gluten|nuts?|shellfish|egg|eggs|sesame|soya|soy)\b/i.test(String(value || ""));
}

function isCpuDietaryHeading_(value) {
  return /^\s*(dietary|allergens?|allergies|dietary requirements?)\s*:?\s*$/i.test(String(value || ""));
}

function isCpuExplicitDietaryLine_(value) {
  const text = cpuCleanText_(value);
  if (/^\s*(?:\d+\s*[x×]|[x×]\s*\d+)\s*(?:veg|vege|veggie|vegan|vegetarian)\s*$/i.test(text)) return true;
  if (/^\s*(?:\d+\s*[x×]|[x×]\s*\d+)\s+.{3,}\b(?:sesame|soy|soya|nuts?|gluten|dairy)\b/i.test(text)) return false;
  if (/^\s*[-*•]\s*.{3,}\b(?:sesame|soy|soya|nuts?|gluten|dairy)\b/i.test(text) &&
      !/\b(?:allerg|free|without|exclude|intolerance)\b/i.test(text)) return false;
  if (!isCpuDietaryLine_(text)) return false;
  return /^(?:dietary|allergens?|allergies)\b/i.test(text) ||
    /^\s*[x×]\s*\d*\s*(?:gluten|dairy|nut|vegan|vegetarian|halal|kosher|allerg)/i.test(text) ||
    /^\s*(?:\d+\s+)?(?:no|without|exclude|excluding|hold)\s+/i.test(text) ||
    /\b(?:attendee|guest|person|people)\b.{0,55}\b(?:allerg|gluten|dairy|vegan|vegetarian|halal|kosher)\b/i.test(text) ||
    text.length <= 55;
}

function isCpuCommentLine_(value) {
  return /^\s*(?:\d+\s+)?(?:note|notes|comment|comments|instruction|instructions|special request|special requests)\s*[:\-]/i.test(String(value || "")) ||
    /\b(please (?:ensure|note|provide|deliver|set|leave|collect)|do not|must be|to be served|to be delivered)\b/i.test(String(value || ""));
}

function isCpuBoilerplateLine_(value) {
  const text = String(value || "").toLowerCase();
  return /all (?:allergen and )?dietary requirements must be provided|green shaded boxes|save a copy and send it|order total|management fee|total net|total gross|vat \(/.test(text) ||
    /^\s*menu\s*[-:]*\s*$/.test(text);
}

function normaliseCpuNoteLine_(value) {
  return cpuCleanText_(value)
    .replace(/^\d+\s+(?=(?:allerg|dietary|vegan|vegetarian|gluten|dairy|nut|shellfish|shrimp|prawn))/i, "")
    .replace(/^\d+\s+(?=(?:note|notes|comment|comments|instruction|instructions)\s*[:\-])/i, "")
    .replace(/^(?:note|notes|comment|comments|dietary(?: requirements?)?|allergens?|allergies)\s*[:\-]\s*/i, "")
    .trim();
}

function cleanCpuProductName_(value) {
  return cpuCleanText_(value)
    .replace(/^\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*[-–—:]\s*/i, "")
    .replace(/^\s*(?:delivery|service)?\s*\d{1,2}(?::|\.)\d{2}\s*(?:am|pm)?\s*[-–—:]\s*/i, "")
    .replace(/^\s*\d+\s*[x×]\s*/i, "")
    .replace(/^\s*[x×]\s*\d+\s*/i, "")
    .replace(/^\s*\d{1,2}\s*(?:am|pm)\s*[-–—:]\s*/i, "")
    .replace(/^\s*[•·\-–—]+\s*/, "")
    .replace(/\s*[-–—]\s*£\s*\d+(?:\.\d{1,2})?(?:\s*p\/p)?(?:\s*=\s*£\s*\d+(?:\.\d{1,2})?)?\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?(?:\s*p\s*\/?\s*p)?(?:\s*=\s*(?:£|gbp)\s*\d+(?:[.,]\d{1,2})?)?[\s\S]*$/i, "")
    .replace(/\s*=\s*£\s*\d+(?:\.\d{1,2})?\s*$/i, "")
    .replace(/\s*£\s*\d+(?:[.,]\d{1,2})?(?:\s*\([^)]*\))?\s*$/i, "")
    .replace(/\s+(?:example menu|delivery charge|total net|vat|total gross)[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseCpuProductSourceText_(value) {
  return cpuCleanMultilineText_(
    decodeCpuXmlText_(String(value || ""))
      .replace(/\u00a0/g, " ")
      .replace(/(\d)\s*\n\s*[x×]\s*/gi, "$1x ")
      .replace(/(\d)\s*[x×]\s*\n\s*/gi, "$1x ")
      .replace(/([a-z])\s*\n\s*[-–—]\s*(?=(?:£|gbp)\s*\d)/gi, "$1 - ")
      .replace(/(?:£|gbp)\s*\n\s*(\d)/gi, "£$1")
  );
}

function cpuParserDiagnosticExcerpt_(text) {
  const source = normaliseCpuProductSourceText_(text);
  const lines = source.split(/\n/).map(cpuCleanText_).filter(Boolean);
  const likely = lines.filter(function(line) {
    return /[x×]|£|gbp|salad|protein|lunch|breakfast/i.test(line);
  }).slice(0, 8);
  return likely.join(" | ").slice(0, 700);
}

function joinCpuNotes_(existing, additions) {
  const values = [existing].concat(additions || [])
    .map(cpuCleanText_)
    .filter(Boolean);
  return uniqueCpuStrings_(values).join("\n");
}

function cpuMatchField_(text, labels) {
  for (let i = 0; i < labels.length; i++) {
    const escaped = labels[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      "(?:^|\\n|\\|)[ \\t]*" + escaped + "[ \\t]*[:|\\-]?[ \\t]*([^\\n|]{1,160})",
      "i"
    );
    const match = String(text).match(regex);
    if (match) {
      const value = cpuCleanText_(match[1]);
      if (value && value.toLowerCase() !== labels[i].toLowerCase()) return value;
    }
  }
  return "";
}

function cpuNormaliseTime_(value) {
  const range = String(value || "").match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(am|pm)/i
  );
  if (range) {
    let rangeHours = Number(range[1]);
    const rangeMinutes = Number(range[2] || 0);
    const rangeSuffix = String(range[3] || range[4] || "").toLowerCase();
    if (rangeSuffix === "pm" && rangeHours < 12) rangeHours += 12;
    if (rangeSuffix === "am" && rangeHours === 12) rangeHours = 0;
    if (rangeHours <= 23 && rangeMinutes <= 59) {
      return ("0" + rangeHours).slice(-2) + ":" + ("0" + rangeMinutes).slice(-2);
    }
  }
  const match = String(value || "").match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const suffix = String(match[3] || "").toLowerCase();
  if (suffix === "pm" && hours < 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return "";
  return ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2);
}

function cpuParseNumber_(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function cpuCleanText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cpuCleanHtmlText_(value) {
  return decodeCpuHtml_(
    String(value === null || value === undefined ? "" : value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function extractCpuDriveId_(url) {
  const value = String(url || "");
  const match = value.match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function isCpuWordDocument_(mime, name) {
  return String(mime || "").toLowerCase() === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(String(name || ""));
}

function readCpuDocxXmlText_(file) {
  try {
    const blobs = Utilities.unzip(file.getBlob());
    const relevant = blobs.filter(function(blob) {
      const name = String(blob.getName() || "").toLowerCase();
      return /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(name);
    });
    return relevant.map(function(blob) {
      return extractCpuWordXmlText_(blob.getDataAsString("UTF-8"));
    }).filter(Boolean).join("\n");
  } catch (error) {
    return "";
  }
}

function extractCpuWordXmlText_(xml) {
  const prepared = String(xml || "")
    .replace(/<w:tab\b[^>]*\/>/gi, "\t")
    .replace(/<w:br\b[^>]*\/>/gi, "\n")
    .replace(/<\/w:tc>/gi, " | ")
    .replace(/<\/w:tr>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n");
  const values = [];
  const regex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
  let match;
  while ((match = regex.exec(prepared))) {
    values.push(decodeCpuXmlText_(match[1]));
  }
  // Paragraph markers are outside w:t nodes, so also build a layout-aware
  // version by removing tags after preserving the markers above.
  const layoutText = decodeCpuXmlText_(
    prepared
      .replace(/<w:t\b[^>]*>/gi, "")
      .replace(/<\/w:t>/gi, "")
      .replace(/<[^>]+>/g, "")
  );
  return cpuCleanMultilineText_(layoutText || values.join(" "));
}

function mergeCpuDocumentText_() {
  const seen = {};
  return Array.prototype.slice.call(arguments)
    .map(cpuCleanMultilineText_)
    .filter(function(value) {
      if (!value) return false;
      const key = value.replace(/\s+/g, " ").toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .join("\n");
}

function cpuCleanMultilineText_(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeCpuXmlText_(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, number) {
      return String.fromCharCode(Number(number));
    })
    .replace(/&#x([0-9a-f]+);/gi, function(_, number) {
      return String.fromCharCode(parseInt(number, 16));
    });
}

function isCpuSpreadsheet_(mime, name) {
  return String(mime || "").toLowerCase().indexOf("spreadsheet") !== -1 ||
    String(mime || "").toLowerCase().indexOf("excel") !== -1 ||
    /\.(xlsx|xls|csv)$/i.test(String(name || ""));
}

function isCpuPresentation_(mime, name) {
  return String(mime || "").toLowerCase().indexOf("presentation") !== -1 ||
    /\.pptx$/i.test(String(name || ""));
}

function readCpuSpreadsheetFile_(file) {
  let spreadsheetId = file.getId();
  let temporaryId = "";
  if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
    const converted = createCpuConvertedFile_(file, MimeType.GOOGLE_SHEETS, "CPU temporary quote sheet - ");
    spreadsheetId = converted.id;
    temporaryId = spreadsheetId;
  }
  try {
    return parseCpuSpreadsheet_(SpreadsheetApp.openById(spreadsheetId));
  } finally {
    if (temporaryId) {
      try { DriveApp.getFileById(temporaryId).setTrashed(true); } catch (ignore) {}
    }
  }
}

function readCpuPresentationText_(file) {
  let presentationId = file.getId();
  let temporaryId = "";
  if (file.getMimeType() !== MimeType.GOOGLE_SLIDES) {
    const converted = createCpuConvertedFile_(file, MimeType.GOOGLE_SLIDES, "CPU temporary quote slides - ");
    presentationId = converted.id;
    temporaryId = presentationId;
  }
  try {
    const lines = [];
    SlidesApp.openById(presentationId).getSlides().forEach(function(slide) {
      slide.getPageElements().forEach(function(element) {
        if (element.getPageElementType() === SlidesApp.PageElementType.SHAPE) {
          const text = element.asShape().getText().asString();
          if (cpuCleanText_(text)) lines.push(text);
        } else if (element.getPageElementType() === SlidesApp.PageElementType.TABLE) {
          const table = element.asTable();
          for (let row = 0; row < table.getNumRows(); row++) {
            for (let col = 0; col < table.getNumColumns(); col++) {
              const text = table.getCell(row, col).getText().asString();
              if (cpuCleanText_(text)) lines.push(text);
            }
          }
        }
      });
    });
    return lines.join("\n");
  } finally {
    if (temporaryId) {
      try { DriveApp.getFileById(temporaryId).setTrashed(true); } catch (ignore) {}
    }
  }
}

function createCpuConvertedFile_(file, googleMimeType, prefix) {
  return Drive.Files.create(
    { name: prefix + file.getName(), mimeType: googleMimeType },
    file.getBlob(),
    { fields: "id" }
  );
}

function cpuQuoteAttachmentScore_(attachment) {
  const name = String(attachment.title || "").toLowerCase();
  const mime = String(attachment.mimeType || "").toLowerCase();
  let score = 0;
  if (name.indexOf("quote") !== -1) score += 100;
  if (name.indexOf("booking form") !== -1 || name.indexOf("original booking") !== -1) score -= 100;
  if (isCpuWordDocument_(mime, name)) score += 50;
  if (isCpuPresentation_(mime, name)) score += 45;
  if (mime === MimeType.GOOGLE_DOCS) score += 50;
  if (mime === MimeType.GOOGLE_SLIDES) score += 45;
  if (mime === "application/pdf") score += 35;
  if (isCpuSpreadsheet_(mime, name)) score += 10;
  return score;
}

function cpuFormAttachmentScore_(attachment) {
  const name = String(attachment.title || "").toLowerCase();
  const mime = String(attachment.mimeType || "").toLowerCase();
  let score = 0;
  if (name.indexOf("booking form") !== -1 || name.indexOf("original booking") !== -1) score += 100;
  if (name.indexOf("quote") !== -1) score -= 100;
  if (isCpuSpreadsheet_(mime, name) || mime === MimeType.GOOGLE_SHEETS) score += 40;
  return score;
}

function cpuJsonAttachmentScore_(attachment) {
  const name = String(attachment.title || "").toLowerCase();
  const mime = String(attachment.mimeType || "").toLowerCase();
  let score = 0;
  if (name.indexOf("booking object") !== -1 || name.indexOf("booking json") !== -1) score += 120;
  if (/\.json$/i.test(name)) score += 80;
  if (mime === "application/json") score += 80;
  return score;
}

function extractCpuDescriptionAttachments_(description) {
  const html = String(description || "");
  const values = [];
  const regex = /href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const url = decodeCpuHtml_(match[1]);
    const title = cpuCleanText_(decodeCpuHtml_(match[2])) || "Linked quote";
    const id = extractCpuDriveId_(url);
    if (!id) continue;
    values.push({
      fileId: id,
      fileUrl: url,
      title: title,
      mimeType: cpuMimeFromLinkedTitle_(title, url)
    });
  }
  return values;
}

function mergeCpuAttachments_(primary, secondary) {
  const seen = {};
  return (primary || []).concat(secondary || []).filter(function(attachment) {
    const key = cpuAttachmentKey_(attachment);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function cpuAttachmentKey_(attachment) {
  return String(attachment.fileId || extractCpuDriveId_(attachment.fileUrl || "") || attachment.fileUrl || attachment.title || "");
}

function cpuMimeFromLinkedTitle_(title, url) {
  const value = (String(title || "") + " " + String(url || "")).toLowerCase();
  if (value.indexOf("spreadsheets") !== -1 || /\.xlsx?\b/.test(value)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (value.indexOf("presentation") !== -1 || /\.pptx\b/.test(value)) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (value.indexOf("document") !== -1 || /\.docx\b/.test(value)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "";
}

function decodeCpuHtml_(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isCpuUsefulField_(field, value) {
  if (value === null || value === undefined || value === "") return false;
  if (field === "pax") return Number(value) > 0;
  const text = cpuCleanText_(value);
  if (!text) return false;
  const placeholders = /^(name|number|level|type|qty|quantity|service|delivery time|service time|location|host)\s*:?\s*$/i;
  return !placeholders.test(text);
}

function cpuFileReadWarning_(label, error) {
  const message = String(error && error.message || error || "");
  if (/No item with the given ID|not have permission|access denied|forbidden/i.test(message)) {
    return label + " is not shared with the CPU scanner account";
  }
  return label + " could not be read: " + message;
}

function dedupeCpuItems_(items) {
  const seen = {};
  return (items || []).filter(function(item) {
    const key = String(item.name || "").toLowerCase() + "::" + Number(item.quantity || 0);
    if (!item.name || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function uniqueCpuStrings_(values) {
  const seen = {};
  return (values || []).filter(function(value) {
    const key = String(value || "").trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function cpuIso_(date) {
  return date && !isNaN(date.getTime()) ? date.toISOString() : "";
}
