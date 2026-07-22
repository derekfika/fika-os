function getFeedbackPageData(token) {
  const request = findFeedbackRequestByToken_(token);
  if (!request) return { ok: false, state: "invalid" };
  if (request.completed) return { ok: true, state: "completed" };

  markFeedbackRequestOpened_(request);
  const booking = request.booking;
  return {
    ok: true,
    state: "ready",
    booking: {
      bookingReference: booking.bookingId || request.bookingReference,
      eventDate: booking.eventDate || request.eventDate,
      eventType: booking.serviceType || request.eventType,
      companyName: booking.clientCompany || "",
      items: normaliseFeedbackItems_(booking.items || [])
    }
  };
}

function submitFeedback(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const request = findFeedbackRequestByToken_(token);
    if (!request) return { ok: false, errors: ["This feedback link is invalid."] };
    if (request.completed) return { ok: false, errors: ["Feedback has already been submitted."] };

    const feedback = buildFeedbackResponse_(request, payload || {});
    const errors = validateFeedback_(feedback);
    if (errors.length) return { ok: false, errors: errors };

    writeFeedbackResponse_(request, feedback);
    markFeedbackRequestCompleted_(request, feedback.submittedAt);
    if (feedback.overallSatisfaction <= 2 && feedback.contactRequested) {
      sendFeedbackRecoveryNotification_(request.context, feedback, request.booking);
    }
    return { ok: true, feedbackId: feedback.feedbackId };
  } finally {
    lock.releaseLock();
  }
}

function buildFeedbackResponse_(request, payload) {
  const itemById = {};
  normaliseFeedbackItems_(request.booking.items || []).forEach(function(item) {
    itemById[item.itemId] = item;
  });
  const submittedRatings = {};
  (payload.itemRatings || []).forEach(function(rating) {
    submittedRatings[String(rating.itemId || "")] = rating;
  });
  const itemRatings = Object.keys(itemById).map(function(itemId) {
    const item = itemById[itemId];
    const rating = submittedRatings[itemId] || {};
    return {
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      rating: feedbackRating_(rating.rating),
      comments: feedbackClean_(rating.comments)
    };
  });

  return {
    feedbackId: "FB-" + Utilities.getUuid(),
    bookingReference: request.bookingReference,
    submittedAt: new Date().toISOString(),
    overallSatisfaction: feedbackRating_(payload.overallSatisfaction),
    foodQuality: feedbackRating_(payload.foodQuality),
    presentation: feedbackRating_(payload.presentation),
    deliveryTiming: feedbackRating_(payload.deliveryTiming),
    easeOfBooking: feedbackRating_(payload.easeOfBooking),
    nps: feedbackNps_(payload.nps),
    itemRatings: itemRatings,
    whatWentWell: feedbackClean_(payload.whatWentWell),
    improvements: feedbackClean_(payload.improvements),
    additionalComments: feedbackClean_(payload.additionalComments),
    contactRequested:
      feedbackRating_(payload.overallSatisfaction) <= 2 &&
      payload.contactRequested === true,
    preferredContactDetails: feedbackClean_(payload.preferredContactDetails)
  };
}

function validateFeedback_(feedback) {
  const errors = [];
  [
    ["overallSatisfaction", "overall satisfaction"],
    ["foodQuality", "food and drink quality"],
    ["presentation", "presentation"],
    ["deliveryTiming", "delivery and timing"],
    ["easeOfBooking", "ease of booking"]
  ].forEach(function(field) {
    if (!feedback[field[0]]) errors.push("Please rate " + field[1] + ".");
  });
  feedback.itemRatings.forEach(function(item) {
    if (!item.rating) errors.push("Please rate " + item.itemName + ".");
  });
  if (feedback.contactRequested && !feedback.preferredContactDetails) {
    errors.push("Please add your preferred contact details.");
  }
  return errors;
}

function writeFeedbackResponse_(request, feedback) {
  const spreadsheet = request.context.spreadsheet;
  const siteId = request.context.site.siteId;
  const responseSheet = spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.responses);
  const itemSheet = spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.itemRatings);
  if (!responseSheet || !itemSheet) throw new Error("Feedback sheets have not been set up.");

  responseSheet.appendRow([
    feedback.feedbackId, feedback.bookingReference, new Date(feedback.submittedAt),
    feedback.overallSatisfaction, feedback.foodQuality, feedback.presentation,
    feedback.deliveryTiming, feedback.easeOfBooking, feedback.nps,
    feedback.whatWentWell, feedback.improvements, feedback.additionalComments,
    feedback.contactRequested, feedback.preferredContactDetails,
    JSON.stringify(feedback), siteId
  ]);

  if (feedback.itemRatings.length) {
    const rows = feedback.itemRatings.map(function(item) {
      return [
        feedback.feedbackId, feedback.bookingReference, item.itemId,
        item.itemName, item.quantity, item.rating, item.comments, siteId
      ];
    });
    itemSheet.getRange(itemSheet.getLastRow() + 1, 1, rows.length, 8)
      .setValues(rows);
  }
}

function findFeedbackRequestByToken_(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return null;
  const contexts = getFeedbackSiteContexts_();
  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex++) {
    const context = contexts[contextIndex];
    const sheet = context.spreadsheet.getSheetByName(FEEDBACK_CONFIG.sheets.requests);
    if (!sheet || sheet.getLastRow() < 2) continue;
    const map = feedbackHeaderMap_(sheet);
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
      .getValues();
    for (let index = 0; index < values.length; index++) {
      const row = values[index];
      if (String(row[map["Feedback Token"] - 1]) !== cleanToken) continue;
      return {
        context: context,
        sheet: sheet,
        rowNumber: index + 2,
        token: cleanToken,
        bookingReference: String(row[map["Booking Reference"] - 1] || ""),
        eventDate: normaliseFeedbackDate_(row[map["Event Date"] - 1]),
        eventType: String(row[map["Event Type"] - 1] || ""),
        completed: feedbackBoolean_(row[map.Completed - 1]),
        booking: feedbackJson_(row[map["Booking Snapshot JSON"] - 1], {})
      };
    }
  }
  return null;
}

function markFeedbackRequestOpened_(request) {
  const sheet = request.sheet;
  const map = feedbackHeaderMap_(sheet);
  if (!feedbackBoolean_(sheet.getRange(request.rowNumber, map.Opened).getValue())) {
    sheet.getRange(request.rowNumber, map.Opened).setValue(true);
    sheet.getRange(request.rowNumber, map["Opened Date"]).setValue(new Date());
  }
}

function markFeedbackRequestCompleted_(request, submittedAt) {
  const sheet = request.sheet;
  const map = feedbackHeaderMap_(sheet);
  sheet.getRange(request.rowNumber, map.Completed).setValue(true);
  sheet.getRange(request.rowNumber, map["Completed Date"]).setValue(new Date(submittedAt));
}

function normaliseFeedbackItems_(items) {
  return (items || []).map(function(item, index) {
    return {
      itemId: String(item.itemId || "item_" + index),
      itemName: String(item.name || item.itemName || "Menu item"),
      quantity: Number(item.qty || item.quantity || 0)
    };
  }).filter(function(item) {
    return item.itemName && item.quantity > 0;
  });
}

function feedbackRating_(value) {
  const number = Math.floor(Number(value || 0));
  return number >= 1 && number <= 5 ? number : 0;
}

function feedbackNps_(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Math.floor(Number(value));
  return number >= 0 && number <= 10 ? number : "";
}

function feedbackClean_(value) {
  return String(value === null || value === undefined ? "" : value)
    .trim().slice(0, 4000);
}

function feedbackJson_(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return fallback;
  }
}

function feedbackBoolean_(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

function normaliseFeedbackDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, FEEDBACK_CONFIG.timeZone, "yyyy-MM-dd");
  }
  return String(value || "");
}
