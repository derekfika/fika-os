function submitBookingRequest(clientPayload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const booking = buildServerBooking_(clientPayload || {});
    const validation = validateBookingRequest_(booking);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, warnings: booking.warnings };
    }

    const integration = writeBookingRequest_(booking);
    const notification = sendNewBookingNotification_(booking, integration);
    return {
      ok: true,
      bookingId: booking.bookingId,
      estimatedTotal: booking.order.netTotal,
      currency: SITE_CONFIG.currency,
      dashboardRow: integration.dashboardRow,
      dashboardStatus: integration.dashboardStatus,
      notificationSent: notification.sent
    };
  } finally {
    lock.releaseLock();
  }
}

function previewBookingRequest(clientPayload) {
  const booking = buildServerBooking_(clientPayload || {});
  const validation = validateBookingRequest_(booking);
  return { ok: validation.ok, errors: validation.errors, booking: booking };
}

function buildServerBooking_(payload) {
  const now = new Date();
  const event = payload.event || {};
  const client = payload.client || {};
  const dietaries = payload.dietaries || {};
  const order = payload.order || {};
  const acknowledgementPayload = payload.acknowledgements || {};
  const noticePolicyAccepted = Boolean(acknowledgementPayload.noticePolicyAccepted);

  const guestCount = Number(event.guestCount || 0);
  const isGallagher = isGallagherBooking_(client);
  const items = recalculateOrderItems_(order.items || [], guestCount, isGallagher);
  const eventType = findEventType_(order.eventType);
  const warnings = buildWarnings_(event, eventType, items, dietaries, now);
  const foodNetTotal = roundMoney_(items.reduce(function(total, item) { return total + item.lineTotal; }, 0));
  const buildingCharges = calculateBuildingCharges_(event);

  return {
    bookingId: generateBookingId_(now),
    submittedAt: now.toISOString(),
    status: "New",
    source: "Client Booking Platform",
    site: SITE_CONFIG.siteName,
    siteId: SITE_CONFIG.siteId,
    client: {
      name: clean_(client.name),
      email: clean_(client.email).toLowerCase(),
      phone: clean_(client.phone),
      companyName: clean_(client.companyName),
      invoiceReference: clean_(client.invoiceReference),
      clientName: clean_(client.clientName),
      clientCompanyName: clean_(client.clientCompanyName)
    },
    event: {
      eventDate: clean_(event.eventDate),
      startTime: clean_(event.startTime),
      endTime: clean_(event.endTime),
      guestCount: Number(event.guestCount || 0),
      floorLevel: clean_(event.floorLevel),
      roomOrArea: clean_(event.roomOrArea),
      deliveryPoint: clean_(event.deliveryPoint),
      onsiteContactName: clean_(event.onsiteContactName),
      onsiteContactPhone: clean_(event.onsiteContactPhone)
    },
    order: {
      eventType: eventType ? eventType.id : clean_(order.eventType),
      items: items,
      foodNetTotal: foodNetTotal,
      buildingCharges: buildingCharges,
      netTotal: roundMoney_(foodNetTotal + buildingCharges.total),
      vatNote: SITE_CONFIG.copy.vatNote
    },
    dietaries: {
      hasDietaries: Boolean(dietaries.hasDietaries),
      vegetarian: positiveInt_(dietaries.vegetarian),
      vegan: positiveInt_(dietaries.vegan),
      glutenFree: positiveInt_(dietaries.glutenFree),
      coeliac: positiveInt_(dietaries.coeliac),
      dairyFree: positiveInt_(dietaries.dairyFree),
      halal: positiveInt_(dietaries.halal),
      otherCount: positiveInt_(dietaries.otherCount),
      allergyDetails: clean_(dietaries.allergyDetails),
      severeAllergyAcknowledged: Boolean(dietaries.severeAllergyAcknowledged),
      freeText: clean_(dietaries.freeText)
    },
    warnings: warnings,
    acknowledgements: {
      quoteSubjectToConfirmation: Boolean((payload.acknowledgements || {}).quoteSubjectToConfirmation),
      noticePolicyAccepted: noticePolicyAccepted,
      cancellationPolicyAccepted: Boolean(acknowledgementPayload.cancellationPolicyAccepted || noticePolicyAccepted),
      cancellationPolicyHours: Number(SITE_CONFIG.rules.cancellationWindowHours),
      cancellationPolicyCopy: formatCancellationPolicyCopy_(SITE_CONFIG.rules.cancellationWindowHours),
      dietaryResponsibilityAccepted: Boolean((payload.acknowledgements || {}).dietaryResponsibilityAccepted)
    },
    specialInstructions: clean_(payload.specialInstructions),
    internal: {
      dashboardProcessed: false,
      quoteCreated: false,
      calendarCreated: false,
      kitchenPrinted: false,
      notes: ""
    }
  };
}

function isGallagherBooking_(client) {
  const company = normalizeCompanyName_(client && client.clientCompanyName);
  const email = clean_(client && client.email).toLowerCase();
  const at = email.lastIndexOf("@");
  const domain = at > -1 ? email.slice(at + 1) : "";
  return company === "gallagher" || domain === "redington.co.uk";
}

function normalizeCompanyName_(value) {
  return clean_(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function effectiveProductMinimum_(minimum, isGallagher) {
  const value = Number(minimum || 0);
  return isGallagher && value > 5 ? 5 : value;
}

function recalculateOrderItems_(requestedItems, guestCount, isGallagher) {
  const menuById = {};
  MENU_SCHEMA.forEach(function(item) { menuById[item.id] = item; });

  return requestedItems.map(function(requested) {
    const schemaItem = menuById[clean_(requested.itemId)];
    const quantity = positiveInt_(requested.quantity);
    if (!schemaItem || !schemaItem.available || quantity < 1) return null;

    const selectedChoices = validateChoices_(schemaItem, requested.choices || []);
    const minimumQuantity = effectiveProductMinimum_(schemaItem.minimumQuantity, isGallagher);
    const minimumGuests = schemaItem.minimumGuests === null
      ? null
      : effectiveProductMinimum_(schemaItem.minimumGuests, isGallagher);
    return {
      category: schemaItem.category,
      itemId: schemaItem.id,
      itemName: schemaItem.name,
      description: schemaItem.description,
      servingInfo: schemaItem.servingInfo,
      unitPrice: roundMoney_(schemaItem.unitPrice),
      priceType: schemaItem.priceType,
      quantity: quantity,
      lineTotal: roundMoney_(schemaItem.unitPrice * quantity),
      timeRequired: clean_(requested.timeRequired),
      choices: selectedChoices,
      comments: clean_(requested.comments),
      minimumOrder: minimumQuantity,
      minimumGuests: minimumGuests,
      noticeRequiredDays: schemaItem.noticeRequiredDays,
      minimumOrderMet: quantity >= minimumQuantity,
      minimumGuestsMet: !minimumGuests || guestCount >= minimumGuests
    };
  }).filter(Boolean);
}

function calculateBuildingCharges_(event) {
  const guestCount = Number(event.guestCount || 0);
  const start = parseClockMinutes_(event.startTime);
  const end = parseClockMinutes_(event.endTime);
  const durationHours = start !== null && end !== null && end > start ? (end - start) / 60 : 0;
  const housekeepingHours = guestCount >= 100 ? durationHours : 0;
  const securityCount = Math.floor(guestCount / 100);
  const securityHours = securityCount ? Math.max(durationHours, 8) : 0;
  const afterSevenHours = start !== null && end !== null && end > start
    ? Math.max(0, end - Math.max(start, 19 * 60)) / 60
    : 0;
  const housekeeping = roundMoney_(housekeepingHours * 23.68);
  const security = roundMoney_(securityCount * securityHours * 29.95);
  const aircon = roundMoney_(afterSevenHours * 200);
  return {
    housekeeping: { hours: housekeepingHours, rate: 23.68, total: housekeeping },
    security: { count: securityCount, hoursPerResource: securityHours, rate: 29.95, total: security },
    aircon: { hours: afterSevenHours, rate: 200, total: aircon },
    total: roundMoney_(housekeeping + security + aircon)
  };
}

function parseClockMinutes_(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(clean_(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function validateChoices_(item, requestedChoices) {
  return item.choices.map(function(group) {
    const match = requestedChoices.find(function(choice) { return choice.id === group.id; }) || {};
    if (isMultiChoiceGroup_(group)) {
      const requestedValues = Array.isArray(match.value)
        ? match.value
        : String(match.value || "").split(/\s*,\s*/);
      const values = requestedValues.map(clean_)
        .filter(function(value) { return group.options.indexOf(value) > -1; });
      const uniqueValues = Array.from(new Set(values));
      return {
        id: group.id,
        label: group.label,
        value: uniqueValues.join(", "),
        values: uniqueValues
      };
    }
    const value = clean_(match.value);
    return {
      id: group.id,
      label: group.label,
      value: group.options.indexOf(value) > -1 ? value : ""
    };
  });
}

function isMultiChoiceGroup_(group) {
  return ["multi", "checkbox", "checkboxes"].indexOf(String(group.type || "").toLowerCase()) > -1;
}

function validateBookingRequest_(booking) {
  const errors = [];
  const c = booking.client;
  const e = booking.event;
  const isGallagher = isGallagherBooking_(c);
  const eventType = findEventType_(booking.order.eventType);

  if (!c.name) errors.push("Your name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.push("A valid email address is required.");
  if (!c.phone) errors.push("Phone number is required.");
  if (!c.companyName) errors.push("Your company is required.");
  if (!c.invoiceReference) errors.push("Reference number is required.");
  if (!c.clientName) errors.push("Client name is required.");
  if (!c.clientCompanyName) errors.push("Client company is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.eventDate)) errors.push("Event date is required.");
  if (!/^\d{2}:\d{2}$/.test(e.startTime)) errors.push("Start time is required.");
  if (eventType && eventType.id === "bespoke" && !/^\d{2}:\d{2}$/.test(e.endTime)) errors.push("End time is required for bespoke events.");
  if (e.endTime && e.endTime <= e.startTime) errors.push("End time must be after the start time.");
  if (!isFinite(e.guestCount) || e.guestCount < 1) errors.push("Guest count must be at least 1.");
  if (isGallagher && (!isFinite(e.guestCount) || e.guestCount < 5)) errors.push("Gallagher bookings require at least 5 guests.");
  if (e.guestCount >= 100 && parseClockMinutes_(e.startTime) === null) errors.push("A valid start time is required for bookings of 100 guests or more.");
  if (e.guestCount >= 100 && parseClockMinutes_(e.endTime) === null) errors.push("A valid end time is required for bookings of 100 guests or more.");
  if (!e.floorLevel && !e.roomOrArea && !e.deliveryPoint) errors.push("Add a floor, room or delivery point.");
  if (!eventType) errors.push("Choose an event type.");
  if (eventType && !eventType.allowsEmptyOrder && !booking.order.items.length) errors.push("Choose at least one menu item.");

  booking.order.items.forEach(function(item) {
    if (eventType && eventType.categories.length && eventType.categories.indexOf(item.category) === -1) {
      errors.push(item.itemName + " is not available for the selected event type.");
    }
    if (!item.minimumOrderMet) errors.push(item.itemName + " requires a minimum quantity of " + item.minimumOrder + ".");
    if (!item.minimumGuestsMet) errors.push(item.itemName + " requires at least " + item.minimumGuests + " guests.");
    const schemaItem = MENU_SCHEMA.find(function(candidate) { return candidate.id === item.itemId; });
    (schemaItem.choices || []).forEach(function(group) {
      const selected = item.choices.find(function(choice) { return choice.id === group.id; });
      if (group.required && (!selected || !hasSelectedChoiceValue_(selected.value))) errors.push("Choose an option for " + item.itemName + ".");
    });
  });

  const a = booking.acknowledgements;
  if (!a.quoteSubjectToConfirmation || !a.noticePolicyAccepted || !a.cancellationPolicyAccepted || !a.dietaryResponsibilityAccepted) {
    errors.push("All booking acknowledgements must be accepted.");
  }
  if (booking.dietaries.allergyDetails && !booking.dietaries.severeAllergyAcknowledged) {
    errors.push("Please acknowledge the severe allergy notice.");
  }

  return { ok: errors.length === 0, errors: errors };
}

function hasSelectedChoiceValue_(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function buildWarnings_(event, eventType, items, dietaries, now) {
  const eventDate = parseEventDate_(event.eventDate, event.startTime);
  const hoursUntil = eventDate ? (eventDate.getTime() - now.getTime()) / 3600000 : 0;
  const workingDaysUntil = eventDate ? workingDaysBetween_(now, eventDate) : 0;
  const dietaryTotal = ["vegetarian", "vegan", "glutenFree", "coeliac", "dairyFree", "halal", "otherCount"]
    .reduce(function(total, key) { return total + positiveInt_(dietaries[key]); }, 0);
  const minimumOrderIssues = items.filter(function(item) { return !item.minimumOrderMet || !item.minimumGuestsMet; })
    .map(function(item) { return item.itemName; });

  return {
    inside72Hours: Boolean(eventDate && hoursUntil < SITE_CONFIG.rules.standardNoticeHours),
    inside10WorkingDays: Boolean(eventDate && eventType && eventType.noticeType === "large" && workingDaysUntil < SITE_CONFIG.rules.largeEventNoticeWorkingDays),
    insideDietaryDeadline: Boolean(eventDate && workingDaysUntil < SITE_CONFIG.rules.dietaryNoticeWorkingDays),
    minimumOrderIssues: minimumOrderIssues,
    dietaryCountIssues: dietaryTotal > Number(event.guestCount || 0) ? ["Dietary counts exceed the guest count."] : [],
    itemNoticeIssues: items.filter(function(item) { return eventDate && workingDaysUntil < item.noticeRequiredDays; })
      .map(function(item) { return item.itemName + " needs " + item.noticeRequiredDays + " days' notice."; })
  };
}

function generateBookingId_(date) {
  const stamp = Utilities.formatDate(date, SITE_CONFIG.timeZone, "yyyyMMdd-HHmmss");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return [SITE_CONFIG.bookingReferencePrefix, stamp, random].join("-");
}

function findEventType_(id) {
  return EVENT_TYPES.find(function(item) { return item.id === id; }) || null;
}

function workingDaysBetween_(from, to) {
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let count = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count++;
  }
  return count;
}

function parseEventDate_(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean_(date))) return null;
  const parts = date.split("-").map(Number);
  const timeParts = /^\d{2}:\d{2}$/.test(clean_(time)) ? time.split(":").map(Number) : [0, 0];
  return new Date(parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1], 0, 0);
}

function positiveInt_(value) {
  const number = Math.floor(Number(value || 0));
  return isFinite(number) && number > 0 ? number : 0;
}

function roundMoney_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clean_(value) {
  return String(value === null || value === undefined ? "" : value).trim().slice(0, 2000);
}
