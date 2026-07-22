function generateQuoteForRow(rowNumber) {
  const sh = getDashboardSheet_();
  const map = getHeaderMap_();

  const json = sh.getRange(rowNumber, map.ParsedJSON).getValue();
  let booking = safeJsonParse_(json, null);

  if (!booking) throw new Error("Could not read booking data.");

  const previousStatus = booking.status || "";
  booking = ensureLineItemTimes_(booking);
  booking = recalculateDashboardTotals_(booking, 0.08);
  booking = validateBooking_(booking);

  if (booking.validationErrors.length > 0) {
    throw new Error("Cannot generate quote. Missing: " + booking.validationErrors.join(", "));
  }

  const folder = getQuoteFolderForBooking_(booking);
  const quoteName = makeQuoteName_(booking);
  const templateId = getConfiguredValue_("QUOTE_TEMPLATE_DOC_ID", CONFIG.QUOTE_TEMPLATE_DOC_ID);

  let quoteFile;

  if (booking.quoteUrl) {
    const existingId = extractDriveIdFromUrl_(booking.quoteUrl);
    if (existingId) {
      quoteFile = DriveApp.getFileById(existingId);
    }
  }

  if (!quoteFile) {
    const template = DriveApp.getFileById(templateId);
    quoteFile = template.makeCopy(quoteName, folder);
  } else {
    quoteFile.setName(quoteName);
    moveQuoteFileToFolder_(quoteFile, folder);
  }

  const doc = DocumentApp.openById(quoteFile.getId());
  if (booking.quoteUrl) resetQuoteDocumentFromTemplate_(doc, templateId);
  clearAndRefillQuoteDoc_(doc, booking);
  doc.saveAndClose();

  booking.quoteUrl = quoteFile.getUrl();
  booking.quoteCreatedAt = new Date();
  booking.status = getStatusAfterQuoteGeneration_(previousStatus);
  booking.quoteStale = false;
  booking.updatedAt = new Date();

  writeBookingObjectToExistingRow_(rowNumber, booking);

  return {
    ok: true,
    quoteUrl: quoteFile.getUrl()
  };
}

function resetQuoteDocumentFromTemplate_(targetDoc, templateId) {
  const templateDoc = DocumentApp.openById(templateId);
  resetQuoteSectionFromTemplate_(targetDoc.getBody(), templateDoc.getBody());

  const sourceHeader = templateDoc.getHeader();
  if (sourceHeader) {
    resetQuoteSectionFromTemplate_(targetDoc.getHeader() || targetDoc.addHeader(), sourceHeader);
  }

  const sourceFooter = templateDoc.getFooter();
  if (sourceFooter) {
    resetQuoteSectionFromTemplate_(targetDoc.getFooter() || targetDoc.addFooter(), sourceFooter);
  }

  templateDoc.saveAndClose();
}

function resetQuoteSectionFromTemplate_(targetSection, sourceSection) {
  targetSection.clear();

  for (let i = 0; i < sourceSection.getNumChildren(); i++) {
    appendQuoteTemplateElement_(targetSection, sourceSection.getChild(i));
  }
}

function appendQuoteTemplateElement_(targetSection, sourceElement) {
  const type = sourceElement.getType();
  const copy = sourceElement.copy();

  if (type === DocumentApp.ElementType.PARAGRAPH) {
    targetSection.appendParagraph(copy.asParagraph());
  } else if (type === DocumentApp.ElementType.TABLE) {
    targetSection.appendTable(copy.asTable());
  } else if (type === DocumentApp.ElementType.LIST_ITEM) {
    targetSection.appendListItem(copy.asListItem());
  } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
    targetSection.appendHorizontalRule();
  } else if (type === DocumentApp.ElementType.PAGE_BREAK) {
    targetSection.appendPageBreak();
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

function recalculateDashboardTotals_(booking, managementFeeRate) {
  const items = Array.isArray(booking.items) ? booking.items : [];
  let hasPricedItems = false;

  const totalPrice = items.reduce(function(total, item) {
    if (!item) return total;

    if (isFiniteDashboardNumber_(item.unitPrice)) {
      const qty = isFiniteDashboardNumber_(item.qty) ? Number(item.qty) : 0;
      const unitPrice = Number(item.unitPrice);
      item.lineTotal = roundMoney_(qty * unitPrice);
      hasPricedItems = true;
      return total + item.lineTotal;
    }

    if (isFiniteDashboardNumber_(item.lineTotal)) {
      hasPricedItems = true;
      return total + Number(item.lineTotal);
    }

    return total;
  }, 0);

  if (!hasPricedItems) return booking;

  const mgmtFee = totalPrice * Number(managementFeeRate || 0);
  const netPrice = totalPrice + mgmtFee;
  const vat = netPrice * 0.20;

  booking.totalPrice = roundMoney_(totalPrice);
  booking.mgmtFee = roundMoney_(mgmtFee);
  booking.netPrice = roundMoney_(netPrice);
  booking.vat = roundMoney_(vat);
  booking.grossPrice = roundMoney_(netPrice + vat);

  return booking;
}

function isFiniteDashboardNumber_(value) {
  if (value === "" || value === null || value === undefined) return false;
  return isFinite(Number(value));
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

  booking.serviceTimes = Array.from(new Set(
    (booking.serviceTimes || [])
      .concat(booking.items.map(item => item.time))
      .map(time => String(time || "").trim())
      .filter(Boolean)
  ));

  return booking;
}

function clearAndRefillQuoteDoc_(doc, booking) {
  const replacements = getQuoteReplacements_(booking);
  const sections = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(Boolean);
  const requiredTokens = ["<SITE>", "<CLIENT>"];

  assertQuoteTokensPresent_(sections, requiredTokens);

  sections.forEach(function(section) {
    Object.keys(replacements).forEach(function(key) {
      replaceQuoteToken_(section, key, replacements[key]);
    });
  });

  assertQuoteTokensReplaced_(sections, requiredTokens);

  const body = doc.getBody();
  styleQuoteNotes_(body, booking.notes || "");
  replaceQuoteOrderPlaceholder_(body, booking.items || []);
}

function getQuoteReplacements_(booking) {
  return {
    "<SITE>": getQuoteSiteCode_(booking),
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
}

function replaceQuoteToken_(section, token, value) {
  const tokenName = String(token || "").replace(/[<>]/g, "");
  const variants = [
    "<" + tokenName.toUpperCase() + ">",
    "<" + tokenName.toLowerCase() + ">",
    "<" + tokenName.charAt(0).toUpperCase() + tokenName.slice(1).toLowerCase() + ">"
  ];

  Array.from(new Set(variants)).forEach(function(variant) {
    section.replaceText(escapeRegex_(variant), String(value || ""));
  });
}

function assertQuoteTokensPresent_(sections, tokens) {
  const documentText = sections.map(function(section) {
    return section.getText();
  }).join("\n");

  const missing = tokens.filter(function(token) {
    return documentText.toUpperCase().indexOf(token.toUpperCase()) === -1;
  });

  if (missing.length) {
    throw new Error("Quote template is missing required placeholders: " + missing.join(", "));
  }
}

function assertQuoteTokensReplaced_(sections, tokens) {
  const documentText = sections.map(function(section) {
    return section.getText();
  }).join("\n");

  const unresolved = tokens.filter(function(token) {
    return documentText.toUpperCase().indexOf(token.toUpperCase()) !== -1;
  });

  if (unresolved.length) {
    throw new Error("Quote placeholders were not replaced: " + unresolved.join(", "));
  }
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

    line.appendText(time).setBold(false).setItalic(false).setFontSize(10);
    line.appendText(item.name || "").setBold(true).setItalic(false).setFontSize(10);
    line.appendText(qty).setBold(false).setItalic(false).setFontSize(10);
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

function previewPastMonthQuoteRenames() {
  return processPastMonthQuoteRenames_(true);
}

function renamePastMonthQuotesToCurrentFormat() {
  return processPastMonthQuoteRenames_(false);
}

function processPastMonthQuoteRenames_(dryRun) {
  const lookbackDays = 30;
  const sheet = getDashboardSheet_();
  const map = getHeaderMap_();

  if (!map.ParsedJSON) throw new Error("ParsedJSON column not found.");

  const lastRow = sheet.getLastRow();
  const result = {
    ok: true,
    dryRun: Boolean(dryRun),
    lookbackDays: lookbackDays,
    checked: 0,
    eligible: 0,
    wouldRename: 0,
    renamed: 0,
    unchanged: 0,
    skippedWithoutQuote: 0,
    skippedOutsideWindow: 0,
    failed: 0,
    rows: []
  };

  if (lastRow < 2) {
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  rows.forEach(function(row, index) {
    const rowNumber = index + 2;
    const booking = safeJsonParse_(row[map.ParsedJSON - 1], null);
    const quoteUrl = booking && booking.quoteUrl
      ? booking.quoteUrl
      : (map.QuoteURL ? row[map.QuoteURL - 1] : "");

    result.checked++;

    if (!quoteUrl) {
      result.skippedWithoutQuote++;
      return;
    }

    try {
      if (!booking) throw new Error("Booking data could not be read.");

      const fileId = extractDriveIdFromUrl_(quoteUrl);
      if (!fileId) throw new Error("Quote file ID could not be read.");

      const quoteFile = DriveApp.getFileById(fileId);
      const lastUpdated = quoteFile.getLastUpdated();

      if (lastUpdated < cutoff) {
        result.skippedOutsideWindow++;
        return;
      }

      result.eligible++;

      const currentName = quoteFile.getName();
      const targetName = makeQuoteName_(booking);

      if (currentName === targetName) {
        result.unchanged++;
        return;
      }

      if (dryRun) {
        result.wouldRename++;
      } else {
        quoteFile.setName(targetName);
        result.renamed++;
      }

      result.rows.push({
        rowNumber: rowNumber,
        bookingId: booking.bookingId || "",
        action: dryRun ? "WOULD_RENAME" : "RENAMED",
        previousName: currentName,
        targetName: targetName,
        lastUpdated: lastUpdated.toISOString()
      });
    } catch (error) {
      result.ok = false;
      result.failed++;
      result.rows.push({
        rowNumber: rowNumber,
        bookingId: booking && booking.bookingId ? booking.bookingId : "",
        error: String(error && error.message ? error.message : error)
      });
    }
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function previewPastMonthQuoteDocumentFixes() {
  return processPastMonthQuoteDocumentFixes_(true);
}

function updatePastMonthQuoteDocumentsSiteAndClient() {
  return processPastMonthQuoteDocumentFixes_(false);
}

function processPastMonthQuoteDocumentFixes_(dryRun) {
  const lookbackDays = 30;
  const sheet = getDashboardSheet_();
  const map = getHeaderMap_();

  if (!map.ParsedJSON) throw new Error("ParsedJSON column not found.");

  const lastRow = sheet.getLastRow();
  const result = {
    ok: true,
    dryRun: Boolean(dryRun),
    lookbackDays: lookbackDays,
    checked: 0,
    eligible: 0,
    wouldUpdate: 0,
    updated: 0,
    unchanged: 0,
    needsReview: 0,
    skippedWithoutQuote: 0,
    skippedOutsideWindow: 0,
    failed: 0,
    rows: []
  };

  if (lastRow < 2) {
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  rows.forEach(function(row, index) {
    const rowNumber = index + 2;
    const booking = safeJsonParse_(row[map.ParsedJSON - 1], null);
    const quoteUrl = booking && booking.quoteUrl
      ? booking.quoteUrl
      : (map.QuoteURL ? row[map.QuoteURL - 1] : "");

    result.checked++;

    if (!quoteUrl) {
      result.skippedWithoutQuote++;
      return;
    }

    try {
      if (!booking) throw new Error("Booking data could not be read.");

      const fileId = extractDriveIdFromUrl_(quoteUrl);
      if (!fileId) throw new Error("Quote file ID could not be read.");

      const quoteFile = DriveApp.getFileById(fileId);
      const lastUpdated = quoteFile.getLastUpdated();

      if (lastUpdated < cutoff) {
        result.skippedOutsideWindow++;
        return;
      }

      result.eligible++;

      const doc = DocumentApp.openById(fileId);
      const sections = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(Boolean);
      const replacements = {
        "<SITE>": getQuoteSiteCode_(booking),
        "<CLIENT>": booking.clientCompany || ""
      };
      const documentText = sections.map(function(section) {
        return section.getText();
      }).join("\n");
      const tokensToReplace = Object.keys(replacements).filter(function(token) {
        return documentText.toUpperCase().indexOf(token.toUpperCase()) !== -1;
      });
      const missingValues = Object.keys(replacements).filter(function(token) {
        return !String(replacements[token] || "").trim();
      });

      if (missingValues.length) {
        throw new Error("Booking is missing values for: " + missingValues.join(", "));
      }

      const unresolvedFields = Object.keys(replacements).filter(function(token) {
        const hasPlaceholder = tokensToReplace.indexOf(token) !== -1;
        const hasExpectedValue = documentText.toUpperCase().indexOf(String(replacements[token]).toUpperCase()) !== -1;
        return !hasPlaceholder && !hasExpectedValue;
      });

      if (!tokensToReplace.length) {
        if (unresolvedFields.length) {
          result.ok = false;
          result.needsReview++;
          result.rows.push({
            rowNumber: rowNumber,
            bookingId: booking.bookingId || "",
            action: "NEEDS_REVIEW",
            missingPlaceholders: unresolvedFields
          });
        } else {
          result.unchanged++;
        }
        return;
      }

      if (dryRun) {
        result.wouldUpdate++;
      } else {
        tokensToReplace.forEach(function(token) {
          sections.forEach(function(section) {
            replaceQuoteToken_(section, token, replacements[token]);
          });
        });
        assertQuoteTokensReplaced_(sections, tokensToReplace);
        doc.saveAndClose();
        result.updated++;
      }

      if (unresolvedFields.length) {
        result.ok = false;
        result.needsReview++;
      }

      result.rows.push({
        rowNumber: rowNumber,
        bookingId: booking.bookingId || "",
        action: dryRun ? "WOULD_UPDATE_DOCUMENT" : "UPDATED_DOCUMENT",
        placeholders: tokensToReplace,
        needsReview: unresolvedFields
      });
    } catch (error) {
      result.ok = false;
      result.failed++;
      result.rows.push({
        rowNumber: rowNumber,
        bookingId: booking && booking.bookingId ? booking.bookingId : "",
        action: "FAILED",
        error: String(error && error.message ? error.message : error)
      });
    }
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function makeQuoteName_(booking) {
  return [
    getQuoteSiteCode_(booking),
    booking.clientCompany || "Unknown Client",
    booking.hostName || booking.hostEmail || "Unknown Host",
    getPrimaryQuoteServiceType_(booking)
  ]
    .map(cleanQuoteNamePart_)
    .join("_");
}

function getPrimaryQuoteServiceType_(booking) {
  const serviceTypes = String(booking.serviceType || "")
    .split(/\s*(?:\/|\||,|;)\s*/)
    .map(function(serviceType) {
      return String(serviceType || "").trim();
    })
    .filter(Boolean);

  if (!serviceTypes.length) return "Hospitality";

  const breakfastOrLunch = serviceTypes.find(function(serviceType) {
    return /\b(breakfast|lunch)\b/i.test(serviceType);
  });

  if (breakfastOrLunch) return breakfastOrLunch;

  const primaryService = serviceTypes.find(function(serviceType) {
    return !/\b(drinks?|beverages?|add[\s-]?ons?|add[\s-]?on packages?)\b/i.test(serviceType);
  });

  return primaryService || serviceTypes[0];
}

function getQuoteSiteCode_(booking) {
  return (
    CONFIG.LOCATION_SHORT_CODE ||
    getConfiguredValue_("LOCATION_SHORT_CODE", "") ||
    CONFIG.LOCATION_NAME ||
    getConfiguredValue_("LOCATION_NAME", "") ||
    booking.location ||
    "Unknown Site"
  );
}

function cleanQuoteNamePart_(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
