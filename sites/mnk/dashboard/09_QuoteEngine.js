function generateQuoteForRow(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  const previousStatus = booking.status || "";
  booking = ensureLineItemTimes_(booking);
  booking = applyMnkDeliveryCharge_(booking);
  booking = validateBooking_(booking);

  if (booking.validationErrors.length > 0) {
    throw new Error("Cannot generate quote. Missing: " + booking.validationErrors.join(", "));
  }

  const folder = getQuoteFolderForBooking_(booking);
  const quoteName = makeQuoteName_(booking);

  const templateId = getConfiguredValue_("QUOTE_TEMPLATE_DOC_ID", CONFIG.QUOTE_TEMPLATE_DOC_ID);
  const template = DriveApp.getFileById(templateId);
  let quoteFile = null;
  const existingQuoteId = extractDriveIdFromUrl_(booking.quoteUrl || "");
  let reusedExistingQuote = false;

  if (existingQuoteId) {
    try {
      quoteFile = DriveApp.getFileById(existingQuoteId);
      quoteFile.setName(quoteName);
      reusedExistingQuote = true;
    } catch (e) {
      quoteFile = null;
    }
  }

  if (!quoteFile) {
    quoteFile = template.makeCopy(quoteName, folder);
  } else {
    moveQuoteFileToFolder_(quoteFile, folder);
  }

  const doc = DocumentApp.openById(quoteFile.getId());
  resetQuoteDocFromTemplate_(doc, templateId);
  clearAndRefillQuoteDoc_(doc, booking);
  doc.saveAndClose();

  booking.quoteUrl = quoteFile.getUrl();
  booking.quoteFileId = quoteFile.getId();
  booking.quoteRegeneratedInPlace = reusedExistingQuote;
  booking.quoteLastRegeneratedAt = reusedExistingQuote ? new Date() : "";
  booking.quoteCreatedAt = new Date();
  booking.status = getStatusAfterQuoteGeneration_(previousStatus);
  booking.quoteStale = false;
  const calendarAttachmentRefreshed = refreshCalendarQuoteAttachmentsAfterQuote_(booking, quoteFile);
  if (calendarAttachmentRefreshed === false) {
    booking.calendarStale = true;
  }
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return {
    ok: true,
    quoteUrl: quoteFile.getUrl(),
    quoteFileId: quoteFile.getId(),
    reusedExistingQuote: reusedExistingQuote
  };
}

function resetQuoteDocFromTemplate_(targetDoc, templateId) {
  const templateDoc = DocumentApp.openById(templateId);
  const sourceBody = templateDoc.getBody();
  const targetBody = targetDoc.getBody();

  removeAllBodyChildren_(targetBody);

  for (let i = 0; i < sourceBody.getNumChildren(); i++) {
    appendCopiedBodyElement_(targetBody, sourceBody.getChild(i));
  }

  removeLeadingEmptyParagraph_(targetBody);

  templateDoc.saveAndClose();
}

function removeAllBodyChildren_(body) {
  body.appendParagraph("");

  for (let i = body.getNumChildren() - 2; i >= 0; i--) {
    body.removeChild(body.getChild(i));
  }
}

function removeLeadingEmptyParagraph_(body) {
  if (body.getNumChildren() < 2) return;

  const first = body.getChild(0);
  if (first.getType() !== DocumentApp.ElementType.PARAGRAPH) return;
  if (first.asParagraph().getText()) return;

  body.removeChild(first);
}

function appendCopiedBodyElement_(targetBody, sourceElement) {
  const type = sourceElement.getType();
  const copy = sourceElement.copy();

  if (type === DocumentApp.ElementType.PARAGRAPH) {
    targetBody.appendParagraph(copy.asParagraph());
    return;
  }

  if (type === DocumentApp.ElementType.TABLE) {
    targetBody.appendTable(copy.asTable());
    return;
  }

  if (type === DocumentApp.ElementType.LIST_ITEM) {
    targetBody.appendListItem(copy.asListItem());
    return;
  }

  if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
    targetBody.appendHorizontalRule();
    return;
  }

  if (type === DocumentApp.ElementType.PAGE_BREAK) {
    targetBody.appendPageBreak();
  }
}

function getStatusAfterQuoteGeneration_(previousStatus) {
  const status = String(previousStatus || "");
  const preserveStatuses = [
    CONFIG.STATUS.CPU_CREATED,
    CONFIG.STATUS.CONFIRMED,
    CONFIG.STATUS.CANCELLED,
    CONFIG.STATUS.ARCHIVED
  ];

  return preserveStatuses.indexOf(status) > -1
    ? status
    : CONFIG.STATUS.QUOTE_GENERATED;
}

function refreshCalendarQuoteAttachmentsAfterQuote_(booking, quoteFile) {
  if (!booking.calendarEventId && !booking.calendarEventUrl) return null;

  if (typeof refreshCalendarQuoteAttachmentsForBooking_ !== "function") {
    return false;
  }

  try {
    return refreshCalendarQuoteAttachmentsForBooking_(booking, quoteFile) === true;
  } catch (error) {
    console.warn(
      "Calendar quote attachment could not be refreshed for " +
      (booking.bookingId || "unknown booking") +
      ": " +
      (error && error.message ? error.message : String(error))
    );
    return false;
  }
}

function restoreQuoteGeneratedRowsToConfirmed() {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const statusCol = map.Status;
  const parsedJsonCol = map.ParsedJSON;

  if (!statusCol) throw new Error("Status column not found.");
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

  const results = {
    ok: true,
    updated: 0,
    skipped: 0,
    rows: []
  };

  for (let rowNumber = 2; rowNumber <= sh.getLastRow(); rowNumber++) {
    const status = String(sh.getRange(rowNumber, statusCol).getValue() || "");
    const booking = safeJsonParse_(sh.getRange(rowNumber, parsedJsonCol).getValue(), null);

    if (status !== CONFIG.STATUS.QUOTE_GENERATED || !booking) {
      results.skipped++;
      continue;
    }

    booking.status = CONFIG.STATUS.CONFIRMED;
    booking.updatedAt = new Date();
    writeBookingObjectToExistingRow_(rowNumber, booking);

    results.updated++;
    results.rows.push({
      rowNumber: rowNumber,
      bookingId: booking.bookingId || "",
      status: booking.status
    });
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function regenerateAllQuotesWithoutManagementFee() {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const quoteUrlCol = map.QuoteURL;
  const parsedJsonCol = map.ParsedJSON;

  if (!quoteUrlCol) throw new Error("QuoteURL column not found.");
  if (!parsedJsonCol) throw new Error("ParsedJSON column not found.");

  const lastRow = sh.getLastRow();
  const results = {
    ok: true,
    checked: Math.max(0, lastRow - 1),
    regenerated: 0,
    skipped: 0,
    failed: 0,
    rows: []
  };

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const quoteUrl = getExistingQuoteUrlForRow_(sh, rowNumber, map);

    if (!quoteUrl) {
      results.skipped++;
      continue;
    }

    try {
      const before = getBookingTotalsForRow_(sh, rowNumber, map);
      const res = generateQuoteForRow(rowNumber);
      const after = getBookingTotalsForRow_(sh, rowNumber, map);
      results.regenerated++;
      results.rows.push({
        rowNumber: rowNumber,
        ok: true,
        quoteUrl: res.quoteUrl,
        before: before,
        after: after
      });
    } catch (e) {
      results.failed++;
      results.ok = false;
      results.rows.push({
        rowNumber: rowNumber,
        ok: false,
        error: String(e && e.message ? e.message : e)
      });
    }
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function getBookingTotalsForRow_(sheet, rowNumber, map) {
  const parsedJsonCol = map.ParsedJSON;
  const booking = parsedJsonCol
    ? safeJsonParse_(sheet.getRange(rowNumber, parsedJsonCol).getValue(), {})
    : {};

  return {
    totalPrice: booking.totalPrice || 0,
    mgmtFee: booking.mgmtFee || 0,
    netPrice: booking.netPrice || 0,
    vat: booking.vat || 0,
    grossPrice: booking.grossPrice || 0,
    quoteUrl: booking.quoteUrl || ""
  };
}

function auditExistingQuoteUrlsForRegeneration() {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const quoteUrlCol = map.QuoteURL;
  const parsedJsonCol = map.ParsedJSON;
  const lastRow = sh.getLastRow();
  const rows = [];

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const sheetQuoteUrl = quoteUrlCol
      ? String(sh.getRange(rowNumber, quoteUrlCol).getValue() || "").trim()
      : "";
    const booking = parsedJsonCol
      ? safeJsonParse_(sh.getRange(rowNumber, parsedJsonCol).getValue(), {})
      : {};
    const parsedQuoteUrl = booking && booking.quoteUrl ? String(booking.quoteUrl).trim() : "";
    const recalculated = booking ? applyMnkDeliveryCharge_(Object.assign({}, booking)) : {};

    rows.push({
      rowNumber: rowNumber,
      bookingId: booking.bookingId || "",
      status: booking.status || "",
      sheetQuoteUrl: sheetQuoteUrl,
      parsedQuoteUrl: parsedQuoteUrl,
      totalPrice: booking.totalPrice || 0,
      mgmtFee: booking.mgmtFee || 0,
      netPrice: booking.netPrice || 0,
      vat: booking.vat || 0,
      recalculatedTotalPrice: recalculated.totalPrice || 0,
      recalculatedMgmtFee: recalculated.mgmtFee || 0,
      recalculatedNetPrice: recalculated.netPrice || 0,
      recalculatedVat: recalculated.vat || 0,
      wouldRegenerate: Boolean(sheetQuoteUrl || parsedQuoteUrl)
    });
  }

  Logger.log(JSON.stringify(rows, null, 2));
  return rows;
}

function getExistingQuoteUrlForRow_(sheet, rowNumber, map) {
  const quoteUrlCol = map.QuoteURL;
  const parsedJsonCol = map.ParsedJSON;
  const sheetQuoteUrl = quoteUrlCol
    ? String(sheet.getRange(rowNumber, quoteUrlCol).getValue() || "").trim()
    : "";

  if (sheetQuoteUrl) return sheetQuoteUrl;

  if (!parsedJsonCol) return "";

  const booking = safeJsonParse_(sheet.getRange(rowNumber, parsedJsonCol).getValue(), null);
  return booking && booking.quoteUrl ? String(booking.quoteUrl).trim() : "";
}

function ensureLineItemTimes_(booking) {
  const defaultTime =
    booking.serviceTimes && booking.serviceTimes.length
      ? booking.serviceTimes[0]
      : "";

  booking.items = (booking.items || []).map(item => {
    if (!item.time) item.time = defaultTime;
    item.time = String(item.time || "").trim();
    return item;
  });

  return booking;
}

function clearAndRefillQuoteDoc_(doc, booking) {
  const body = doc.getBody();

  const replacements = {
    "<SITE>": getConfiguredValue_("LOCATION_SHORT_CODE", CONFIG.LOCATION_SHORT_CODE || "") || getConfiguredValue_("LOCATION_NAME", CONFIG.LOCATION_NAME || "") || booking.location || "",
    "<CLIENT>": booking.clientCompany || "",
    "<FLOOR>": booking.floor || "",
    "<DAY>": formatDayName_(booking.eventDate),
    "<PAX>": booking.pax || "",
    "<DATE>": formatUkDate_(booking.eventDate),
    "<SERVICE>": booking.serviceType || "",
    "<DELIVERYTIME>": (booking.serviceTimes || []).join(" / "),
    "<SERVICETIME>": (booking.serviceTimes || []).join(" / "),
    "<LOCATION>": getBookingRoomOrLocation_(booking),
    "<HOST>": booking.hostName || booking.hostEmail || "",
    "<INVOICEREFERENCE>": booking.invoiceReference || "",
    "<INVOICE_REFERENCE>": booking.invoiceReference || "",
    "<NOTES>": booking.notes || "",
    "<TOTAL_PRICE>": formatMoney_(booking.totalPrice),
    "<MGMTFEE>": formatMoney_(booking.mgmtFee),
    "<NETPRICE>": formatMoney_(booking.netPrice),
    "<VAT>": formatMoney_(booking.vat),
    "<GROSSPRICE>": formatMoney_(booking.grossPrice)
  };

  Object.keys(replacements).forEach(key => {
    body.replaceText(escapeRegex_(key), String(replacements[key] || ""));
  });

  styleQuoteNotes_(body, booking.notes || "");

  replaceQuoteOrderPlaceholder_(body, buildQuoteItems_(booking));
}

function styleQuoteNotes_(body, notesText) {
  if (!notesText) return;

  const cleanNotes = String(notesText).trim();
  if (!cleanNotes) return;

  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);

    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    const p = child.asParagraph();
    const text = p.getText();

    if (text.includes(cleanNotes)) {

      p.setForegroundColor("#C05050");
      p.setBold(true);
      p.setFontSize(10);

      const textElement = p.editAsText();

      textElement.setBold(0, text.length - 1, true);
      textElement.setForegroundColor(0, text.length - 1, "#C05050");

      return;
    }
  }
}

function replaceQuoteOrderPlaceholder_(body, items) {
  let targetIndex = -1;

  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    const text = child.asParagraph().getText();
    if (text.includes("<ORDER>")) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) return;

  body.removeChild(body.getChild(targetIndex));

  let insertIndex = targetIndex;
  let currentSection = "";

  items.forEach(item => {
    if (item.section && item.section !== currentSection) {
      currentSection = item.section;

      const section = body.insertParagraph(insertIndex++, currentSection.toUpperCase());
      section.setBold(true);
      section.setFontSize(11);
      section.setSpacingBefore(8);
      section.setSpacingAfter(2);
    }

    const line = body.insertParagraph(insertIndex++, "");
    line.setFontSize(10);
    line.setSpacingAfter(2);

    const time = item.time ? item.time + " - " : "";
    const qty = item.qty ? " x " + item.qty : "";

    appendQuoteText_(line, time, false, false, 10);
    appendQuoteText_(line, item.name || "Untitled item", true, false, 10);
    appendQuoteText_(line, qty, false, false, 10);
    appendQuoteText_(line, getQuoteItemPriceText_(item), false, false, 10);

    const detailParts = [];
    if (item.detail) detailParts.push(item.detail);
    if (item.info) detailParts.push(item.info);

    if (detailParts.length) {
      const detail = body.insertParagraph(insertIndex++, detailParts.join(" - "));
      detail.setFontSize(8);
      detail.setItalic(true);
      detail.setSpacingAfter(2);
    }

    const instructionParts = getQuoteItemInstructionParts_(item);
    if (instructionParts.length) {
      insertIndex = appendQuoteItemInstructions_(body, insertIndex, instructionParts);
    }
  });
}

function getQuoteItemInstructionParts_(item) {
  const fields = [
    ["Comment", item.comment || item.comments],
    ["Allergen info", item.allergenInfo || item.allergens || item.allergyDetails],
    ["Requirements", item.requirements || item.specialRequirements || item.specialInstructions]
  ];

  return fields
    .map(function(field) {
      const value = String(field[1] || "").trim();
      return value ? field[0] + ": " + value : "";
    })
    .filter(Boolean);
}

function appendQuoteItemInstructions_(body, insertIndex, instructionParts) {
  const instruction = body.insertParagraph(insertIndex++, instructionParts.join(" - "));
  instruction.setFontSize(8);
  instruction.setBold(true);
  instruction.setItalic(false);
  instruction.setForegroundColor("#C05050");
  instruction.setSpacingAfter(5);

  const text = instruction.editAsText();
  const value = instruction.getText();
  if (value) {
    text.setBold(0, value.length - 1, true);
    text.setForegroundColor(0, value.length - 1, "#C05050");
  }

  return insertIndex;
}

function appendQuoteText_(paragraph, text, bold, italic, fontSize) {
  const value = String(text || "");
  if (!value) return null;

  return paragraph
    .appendText(value)
    .setBold(Boolean(bold))
    .setItalic(Boolean(italic))
    .setFontSize(fontSize || 10);
}

function getQuoteItemPriceText_(item) {
  if (isFiniteQuoteNumber_(item.lineTotal)) return " - " + formatMoney_(Number(item.lineTotal));
  if (isFiniteQuoteNumber_(item.unitPrice) && isFiniteQuoteNumber_(item.qty)) {
    return " - " + formatMoney_(Number(item.unitPrice) * Number(item.qty));
  }
  return "";
}

function isFiniteQuoteNumber_(value) {
  if (value === "" || value === null || value === undefined) return false;
  return isFinite(Number(value));
}

function moveQuoteFileToFolder_(quoteFile, folder) {
  if (!quoteFile || !folder) return;
  try {
    quoteFile.moveTo(folder);
  } catch (error) {
    console.warn("Quote file could not be moved to booking-date folder: " + (error && error.message ? error.message : error));
  }
}

function buildQuoteItems_(booking) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  const descriptionsByItemId = {};

  if (
    booking.clientBooking &&
    booking.clientBooking.order &&
    Array.isArray(booking.clientBooking.order.items)
  ) {
    booking.clientBooking.order.items.forEach(function(item) {
      if (item.itemId && item.description) {
        descriptionsByItemId[item.itemId] = item.description;
      }
    });
  }

  return items.map(function(item) {
    if (!item || !item.itemId || !descriptionsByItemId[item.itemId]) return item;

    return Object.assign({}, item, {
      info: descriptionsByItemId[item.itemId]
    });
  });
}

function getBookingRoomOrLocation_(booking) {
  const clientEvent = booking.clientBooking && booking.clientBooking.event
    ? booking.clientBooking.event
    : {};

  return (
    booking.room ||
    booking.roomOrArea ||
    booking.deliveryPoint ||
    clientEvent.roomOrArea ||
    clientEvent.deliveryPoint ||
    booking.location ||
    ""
  );
}

function getQuoteFolderForBooking_(booking) {
  const rootFolderName = getConfiguredValue_("QUOTE_ROOT_FOLDER_NAME", CONFIG.QUOTE_ROOT_FOLDER_NAME || "Hospitality");
  const root = getOrCreateDriveFolder_(rootFolderName);

  const year = booking.eventDate
    ? String(booking.eventDate).slice(0, 4)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy");

  const month = booking.eventDate
    ? formatFolderMonth_(booking.eventDate)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM MMMM");

  const day = booking.eventDate
    ? String(booking.eventDate).slice(0, 10)
    : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  const yearFolder = getOrCreateChildFolder_(root, year);
  const monthFolder = getOrCreateChildFolder_(yearFolder, month);
  return getOrCreateChildFolder_(monthFolder, day);
}

function getOrCreateDriveFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function getOrCreateChildFolder_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function makeQuoteName_(booking) {
  const date = booking.eventDate || "No Date";
  const company = booking.clientCompany || "Unknown Company";
  return `Quote - ${company} - ${date}`;
}

function formatMoney_(n) {
  return "GBP " + Number(n || 0).toFixed(2);
}

function formatUkDate_(isoDate) {
  if (!isoDate) return "";
  const parts = String(isoDate).split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDayName_(isoDate) {
  if (!isoDate) return "";
  const parts = String(isoDate).split("-");
  if (parts.length !== 3) return "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "EEEE");
}

function formatFolderMonth_(isoDate) {
  const parts = String(isoDate).split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "MM MMMM");
}

function extractDriveIdFromUrl_(url) {
  const m = String(url || "").match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

function escapeRegex_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printQuoteForRow(rowNumber) {
  throw new Error("Printing quotes is only enabled on the Angel Court dashboard.");
}

function printQuoteForRowDisabled_(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);
  const siteName = getConfiguredValue_(
  "LOCATION_NAME",
  "FIKA Hospitality"
  );
  
  if (!booking) throw new Error("Could not read booking data.");
  if (!booking.quoteUrl) throw new Error("No quote has been generated yet.");

  const fileId = extractDriveIdFromUrl_(booking.quoteUrl);
  if (!fileId) throw new Error("Could not read quote file ID.");

  const pdfBlob = DriveApp
    .getFileById(fileId)
    .getBlob()
    .getAs(MimeType.PDF)
    .setName(makeQuoteName_(booking) + ".pdf");

  MailApp.sendEmail({
    to: getConfiguredValue_("PRINTER_EMAIL", CONFIG.PRINTER_EMAIL),
    subject: `${siteName} Quote`,
    body: `Auto-printed quote from ${siteName} Dashboard.`
});

  booking.quotePrintedAt = new Date();
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return {
    ok: true
  };
}

function sendBookingConfirmationEmail_(booking) {
  const ccAddress = getConfiguredValue_("CALENDAR_ID", CONFIG.CALENDAR_ID || "");

  const subject =
    `FIKA Hospitality | Booking Confirmed | ${formatEmailDate_(booking.eventDate)}`;

  const htmlBody = buildConfirmationEmailHtml_(booking);
  const plainTextBody = stripHtml_(htmlBody);

  if (!booking.hostEmail) {
  throw new Error("Cannot send confirmation email. Host email is missing.");
  }

  GmailApp.sendEmail(
    booking.hostEmail,
    subject,
    plainTextBody,
    {
      htmlBody: htmlBody,
      cc: ccAddress
    }
  );

  return {
    sentTo: booking.hostEmail
  };
}

function buildConfirmationSubject_(booking) {
  return `FIKA Hospitality | Booking Confirmed | ${formatEmailDate_(booking.eventDate)}`;
}

function buildConfirmationEmailHtml_(booking) {
  const siteName = getConfiguredValue_("LOCATION_NAME", CONFIG.LOCATION_NAME || "FIKA Hospitality");
  const primary = getConfiguredValue_("COLOUR_PRIMARY", CONFIG.COLOUR_PRIMARY || "#4F34C7");
  const accent = getConfiguredValue_("COLOUR_ACCENT", CONFIG.COLOUR_ACCENT || "#FF5C00");
  const paper = getConfiguredValue_("COLOUR_BACKGROUND", CONFIG.COLOUR_BACKGROUND || "#F8F6FF");
  const itemRows = buildConfirmationItemsHtml_(booking.items || []);
  const hostGreeting = booking.hostName ? "Hi " + escapeEmailHtml_(booking.hostName) + "," : "Hi there,";

  return `
  <div style="margin:0; padding:0; background:${escapeEmailHtml_(paper)}; font-family: Arial, Helvetica, sans-serif; color:#241F33; line-height:1.5;">
    <div style="max-width:680px; margin:0 auto; padding:28px 18px;">
      <div style="background:#ffffff; border:1px solid #DDD8EA; border-radius:22px; overflow:hidden;">
        <div style="padding:28px 30px; background:${escapeEmailHtml_(primary)}; color:#ffffff;">
          <div style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; opacity:0.9;">FIKA Hospitality</div>
          <h1 style="margin:8px 0 0; font-size:30px; line-height:1.1; font-weight:700;">Booking confirmed</h1>
          <p style="margin:10px 0 0; font-size:15px;">${escapeEmailHtml_(siteName)} - ${escapeEmailHtml_(formatEmailDate_(booking.eventDate))}</p>
        </div>

        <div style="padding:28px 30px;">
          <p style="margin:0 0 14px;">${hostGreeting}</p>
          <p style="margin:0 0 18px;">Your hospitality booking is confirmed and scheduled with our team. Here is a summary of what we have booked in for you.</p>

          <div style="margin:22px 0; padding:18px; border:1px solid #E4DEEF; border-radius:16px; background:#FBFAFF;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-size:14px;">
              <tr><td style="padding:6px 0; color:#6B627A;">Reference</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.bookingId)}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Client</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.clientCompany || "")}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Service</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.serviceType || "Hospitality")}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Date</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(formatEmailDate_(booking.eventDate))}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Time</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_((booking.serviceTimes || []).join(", "))}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Location</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.location || siteName)}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Floor</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.floor || "")}</td></tr>
              <tr><td style="padding:6px 0; color:#6B627A;">Guests</td><td style="padding:6px 0; text-align:right; font-weight:700;">${escapeEmailHtml_(booking.pax || "")}</td></tr>
            </table>
          </div>

          <h2 style="margin:24px 0 12px; color:${escapeEmailHtml_(primary)}; font-size:20px;">Your booked items</h2>
          ${itemRows}

          <div style="margin:24px 0 0; padding:16px; border-left:4px solid ${escapeEmailHtml_(accent)}; background:#FFF8F4; border-radius:12px;">
            <p style="margin:0; font-size:14px;">No prices are shown here because this is a booking confirmation, not a quote. Labour, equipment hire, VAT or event-specific requirements may be confirmed separately where needed.</p>
          </div>

          <p style="margin:24px 0 0;">If anything needs changing before the service date, please let us know as soon as possible and we will do our best to help.</p>
          <p style="margin:24px 0 0;">Kind regards,<br><strong style="color:${escapeEmailHtml_(primary)};">FIKA Hospitality</strong></p>
        </div>
      </div>
    </div>
  </div>
  `;
}

function buildConfirmationItemsHtml_(items) {
  const rows = (items || []).filter(function(item) {
    return item && (item.name || item.qty || item.detail || item.info || item.comment);
  });

  if (!rows.length) {
    return '<p style="margin:0; color:#6B627A;">No itemised order details were available for this booking.</p>';
  }

  return `
    <div style="border:1px solid #E4DEEF; border-radius:16px; overflow:hidden;">
      ${rows.map(function(item, index) {
        const qty = item.qty || item.quantity || "";
        const title = (qty ? escapeEmailHtml_(qty) + " x " : "") + escapeEmailHtml_(item.name || "Hospitality item");
        const meta = buildConfirmationItemMeta_(item);
        const detail = [item.detail, item.info, item.comment]
          .map(function(value) { return String(value || "").trim(); })
          .filter(Boolean)
          .map(escapeEmailHtml_)
          .join("<br>");

        return `
          <div style="padding:15px 16px; ${index ? "border-top:1px solid #E4DEEF;" : ""}">
            <div style="font-weight:700; color:#241F33;">${title}</div>
            ${meta ? `<div style="margin-top:4px; color:#6B627A; font-size:13px;">${meta}</div>` : ""}
            ${detail ? `<div style="margin-top:8px; color:#4A4358; font-size:13px;">${detail}</div>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildConfirmationItemMeta_(item) {
  return [
    item.time ? "Time: " + item.time : "",
    item.section ? "Section: " + item.section : ""
  ]
    .filter(Boolean)
    .map(escapeEmailHtml_)
    .join(" &bull; ");
}

function escapeEmailHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml_(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&bull;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatEmailDate_(isoDate) {
  if (!isoDate) return "";

  const parts = String(isoDate).split("-");
  if (parts.length !== 3) return isoDate;

  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));

  return Utilities.formatDate(
    d,
    Session.getScriptTimeZone(),
    "dd MMMM yyyy"
  );
}

function cancelBookingForRow(rowNumber, options) {
  options = options || {};

  const sh = getDashboardSheet_();
  const map = getHeaderMap_();
  const calendarId = getConfiguredValue_("CALENDAR_ID", CONFIG.CALENDAR_ID || "primary");

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  const result = {
    ok: true,
    bookingId: booking.bookingId,
    emailSent: false,
    calendarRemoved: false
  };

  if (options.sendEmail) {
    sendBookingCancellationEmail_(booking);
    result.emailSent = true;
  }

  if (options.removeCalendar && booking.calendarEventId) {
    Calendar.Events.remove(
      calendarId,
      booking.calendarEventId,
      {
        sendUpdates: "all"
      }
    );

    result.calendarRemoved = true;

    booking.calendarRemovedAt = new Date();
    booking.calendarEventId = "";
    booking.calendarEventUrl = "";
    booking.calendarStale = false;
  }

  booking.status = CONFIG.STATUS.CANCELLED || "CANCELLED";
  booking.cancelledAt = new Date();
  booking.cancelledBy = Session.getActiveUser().getEmail();
  booking.cancellationEmailSentAt = result.emailSent ? new Date() : "";
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return result;
}

function sendBookingCancellationEmail_(booking) {
  const to = booking.hostEmail;
  const cc = getConfiguredValue_("CALENDAR_ID", CONFIG.CALENDAR_ID || "");

  if (!to) throw new Error("Cannot send cancellation email. Host email is missing.");

  const subject =
    `FIKA Hospitality | Booking Cancelled | ${formatEmailDate_(booking.eventDate)}`;

  const htmlBody = buildCancellationEmailHtml_(booking);

  GmailApp.sendEmail(to, subject, stripHtml_(htmlBody), {
    htmlBody,
    name: "FIKA Hospitality",
    cc
  });

  return { sentTo: to };
}

function buildCancellationEmailHtml_(booking) {
  return `
  <div style="font-family: Arial, sans-serif; color:#241F33; line-height:1.5; padding:24px;">
    <h2 style="color:#FF5C00; margin-bottom:8px;">Booking Cancelled</h2>

    <p>Hi there,</p>

    <p>
      This email is to confirm that the following FIKA Hospitality booking has been cancelled.
    </p>

    <div style="margin:22px 0; padding:18px; border:1px solid #DDD8EA; border-radius:14px; background:#FFF7F2;">
      <p><strong>Booking Reference:</strong> ${escapeEmailHtml_(booking.bookingId)}</p>
      <p><strong>Service:</strong> ${escapeEmailHtml_(booking.serviceType || "Hospitality")}</p>
      <p><strong>Date:</strong> ${escapeEmailHtml_(formatEmailDate_(booking.eventDate))}</p>
      <p><strong>Time:</strong> ${escapeEmailHtml_((booking.serviceTimes || []).join(", "))}</p>
      <p><strong>Location:</strong> ${escapeEmailHtml_(booking.location || "")}</p>
      <p><strong>Floor:</strong> ${escapeEmailHtml_(booking.floor || "")}</p>
      <p><strong>Guests:</strong> ${escapeEmailHtml_(booking.pax || "")}</p>
    </div>

    <p>
      If you think this has been done in error, please do get in touch with us as soon as possible, otherwise no further action is required.<br>
    </p>

    <p style="margin-top:24px;">
      Kind regards,<br>
      <strong>FIKA Hospitality</strong>
    </p>
  </div>
  `;
}
