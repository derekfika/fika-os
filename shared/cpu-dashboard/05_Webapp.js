function doGet() {
  const template = HtmlService.createTemplateFromFile("Index");
  template.appName = getCpuSetting_("APP_NAME", CPU_CONFIG.APP_NAME);
  template.fikaLogoSvg = CPU_CONFIG.FIKA_LOGO_SVG;
  return template.evaluate()
    .setTitle(template.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function getCpuDashboardData(request) {
  request = request || {};
  const rangeStart = normaliseCpuRangeDate_(request.start, "0000-00-00");
  const rangeEnd = normaliseCpuRangeDate_(request.end, "9999-99-99");
  const showUpdatedFlags = cpuBoolSetting_("SHOW_UPDATED_FLAGS", false);
  const cache = CacheService.getScriptCache();
  const cacheKey = [
    "CPU_DASHBOARD",
    CPU_CONFIG.BUILD,
    getCpuDataVersion_(),
    rangeStart,
    rangeEnd,
    showUpdatedFlags ? "UPDATES_ON" : "UPDATES_OFF"
  ].join("_");
  const cached = cache.get(cacheKey);
  if (cached) {
    const cachedPayload = JSON.parse(cached);
    cachedPayload.diagnostics.cacheHit = true;
    return cachedPayload;
  }

  const orders = getCpuOrders_(rangeStart, rangeEnd);
  const deliveries = getCpuDeliveries_(rangeStart, rangeEnd);
  const configuredSites = getCpuSites_();
  const sites = mergeCpuSiteLists_(configuredSites, deriveCpuSitesFromOrders_(orders));
  const ordersSheet = ensureCpuOrdersSheet_();
  const payload = {
    appName: getCpuSetting_("APP_NAME", CPU_CONFIG.APP_NAME),
    build: CPU_CONFIG.BUILD,
    generatedAt: new Date().toISOString(),
    sites: sites,
    productCategories: getCpuProductCategories_(),
    uiSettings: {
      showUpdatedFlags: showUpdatedFlags
    },
    orders: orders,
    deliveries: deliveries,
    configured: getCpuCalendars_().length > 0,
    diagnostics: {
      spreadsheetId: SpreadsheetApp.getActive().getId(),
      sheetName: ordersSheet.getName(),
      sheetRows: Math.max(0, ordersSheet.getLastRow() - 1),
      ordersLoaded: orders.length,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      cacheHit: false
    }
  };
  const serialised = JSON.stringify(payload);
  if (serialised.length < 90000) {
    cache.put(cacheKey, serialised, CPU_CONFIG.CACHE_SECONDS);
  }
  return payload;
}

function getCpuDashboardHealth() {
  const sheet = ensureCpuOrdersSheet_();
  return {
    ok: true,
    build: CPU_CONFIG.BUILD,
    spreadsheetId: SpreadsheetApp.getActive().getId(),
    spreadsheetUrl: SpreadsheetApp.getActive().getUrl(),
    sheetName: sheet.getName(),
    sheetRows: Math.max(0, sheet.getLastRow() - 1)
  };
}

function mergeCpuSiteLists_() {
  const lists = Array.prototype.slice.call(arguments);
  const seen = {};
  const result = [];
  lists.forEach(function(list) {
    (list || []).forEach(function(site) {
      const id = String(site.id || site.code || site.name || "").trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      result.push(site);
    });
  });
  return result;
}

function deriveCpuSitesFromOrders_(orders) {
  const seen = {};
  return (orders || []).filter(function(order) {
    if (!order.siteId || seen[order.siteId]) return false;
    seen[order.siteId] = true;
    return true;
  }).map(function(order) {
    return {
      id: order.siteId,
      name: order.siteName,
      code: order.siteCode,
      colour: order.siteColour,
      emails: order.eventOwnerEmail ? [order.eventOwnerEmail] : []
    };
  });
}

function refreshCpuDashboard(request) {
  const scan = scanCpuCalendars(request || {});
  const data = getCpuDashboardData(request || {});
  return { scan: scan, data: data };
}

function getCpuOrderDetail(orderKey) {
  const orders = getCpuOrders_("0000-01-01", "9999-12-31");
  const order = orders.filter(function(item) { return item.id === orderKey; })[0];
  if (!order) throw new Error("Order not found.");
  return order;
}

function saveCpuOrder(orderKey, patch) {
  return updateCpuOrder_(orderKey, patch || {});
}

function saveCpuPrepPhoto(orderKey, dataUrl, chefName) {
  return saveCpuOrderPhoto_(orderKey, dataUrl, chefName, "prep");
}

function saveCpuAllergenPhoto(orderKey, dataUrl) {
  return saveCpuOrderPhoto_(orderKey, dataUrl, "", "allergen");
}

function saveCpuOrderPhoto_(orderKey, dataUrl, chefName, photoType) {
  if (!orderKey) throw new Error("Order is missing.");
  const match = String(dataUrl || "").match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
  if (!match) throw new Error("No photo was received.");

  const orders = getCpuOrders_("0000-01-01", "9999-12-31");
  const order = orders.filter(function(item) { return item.id === orderKey; })[0];
  if (!order) throw new Error("Order not found.");
  const isAllergen = String(photoType || "").toLowerCase() === "allergen";

  const extension = match[1].toLowerCase() === "png" ? "png" : "jpg";
  const contentType = extension === "png" ? "image/png" : "image/jpeg";
  const bytes = Utilities.base64Decode(match[2]);
  const safeParts = [
    order.eventDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    order.siteCode || "SITE",
    order.clientCompany || "booking",
    isAllergen ? "allergen-sheet" : "prep-proof"
  ].map(function(part) {
    return String(part || "")
      .replace(/[^a-z0-9 _.-]+/gi, "")
      .replace(/\s+/g, "-")
      .slice(0, 48);
  }).filter(Boolean);
  const fileName = safeParts.join("_") + "." + extension;
  const folder = getCpuPrepPhotoFolder_();
  const file = folder.createFile(Utilities.newBlob(bytes, contentType, fileName));

  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (ignore) {
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (ignoreAgain) {}
  }

  const now = new Date().toISOString();
  const preppedBy = String(chefName || order.preppedBy || "").trim();
  const photoRecord = {
    fileId: file.getId(),
    url: file.getUrl(),
    uploadedAt: now,
    label: isAllergen ? "Allergen sheet" : "Prep proof"
  };
  const existingPhotos = isAllergen
    ? (Array.isArray(order.allergenPhotos) ? order.allergenPhotos : [])
    : (Array.isArray(order.prepPhotos) ? order.prepPhotos : []);
  const photos = existingPhotos.concat([photoRecord]);
  const patch = isAllergen
    ? {
        allergenPhotoFileId: file.getId(),
        allergenPhotoUrl: file.getUrl(),
        allergenPhotoAt: now,
        allergenPhotos: photos
      }
    : {
        prepped: true,
        preppedBy: preppedBy,
        prepPhotoFileId: file.getId(),
        prepPhotoUrl: file.getUrl(),
        prepPhotoAt: now,
        prepPhotos: photos
      };
  updateCpuOrder_(orderKey, patch);
  const result = {
    ok: true,
    orderKey: orderKey,
    photoType: isAllergen ? "allergen" : "prep"
  };
  return Object.assign(result, patch);
}

function getCpuPrepPhotoFolder_() {
  const folderName = String(
    getCpuSetting_("PREP_PHOTO_FOLDER_NAME", CPU_CONFIG.PREP_PHOTO_FOLDER_NAME)
  ).trim() || CPU_CONFIG.PREP_PHOTO_FOLDER_NAME;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

function reparseCpuOrderQuote(orderKey) {
  const orders = getCpuOrders_();
  const order = orders.filter(function(item) { return item.id === orderKey; })[0];
  if (!order) throw new Error("Order not found.");
  if (!order.quoteUrl) throw new Error("This order has no quote link.");

  const result = readCpuQuoteAttachment_({
    fileUrl: order.quoteUrl,
    title: order.quoteName || "Quote"
  });
  if (!result.data || !(result.data.items || []).length) {
    const charactersRead = result.diagnostic && result.diagnostic.charactersRead;
    const excerpt = result.diagnostic && result.diagnostic.excerpt;
    throw new Error(
      (result.warnings || []).join(" ") ||
      "The quote was opened, but no production line items could be identified." +
      (charactersRead !== undefined ? " Extracted " + charactersRead + " text characters." : "") +
      (excerpt ? " Parser saw: " + excerpt : "")
    );
  }

  const patch = {
    items: result.data.items,
    dietary: result.data.dietary || order.dietary || "",
    notes: result.data.notes || order.notes || ""
  };
  if (result.data.pax) patch.pax = result.data.pax;
  if (result.data.location) patch.location = result.data.location;
  if (result.data.floor) patch.floor = result.data.floor;
  if (result.data.deliveryTime) patch.deliveryTime = result.data.deliveryTime;
  if (result.data.serviceTime) patch.serviceTime = result.data.serviceTime;

  const warnings = reconcileCpuWarningsAfterQuoteRead_(
    order.warnings || [],
    result.warnings || [],
    result.data,
    order
  );
  patch.warnings = warnings;
  patch.status = warnings.length
    ? CPU_CONFIG.STATUS.NEEDS_ATTENTION
    : CPU_CONFIG.STATUS.READY;

  updateCpuOrder_(orderKey, patch);
  return {
    ok: true,
    items: result.data.items.length,
    parsedItems: result.data.items,
    dietary: patch.dietary,
    notes: patch.notes,
    pax: Object.prototype.hasOwnProperty.call(patch, "pax") ? patch.pax : order.pax,
    location: Object.prototype.hasOwnProperty.call(patch, "location") ? patch.location : order.location,
    floor: Object.prototype.hasOwnProperty.call(patch, "floor") ? patch.floor : order.floor,
    deliveryTime: Object.prototype.hasOwnProperty.call(patch, "deliveryTime") ? patch.deliveryTime : order.deliveryTime,
    serviceTime: Object.prototype.hasOwnProperty.call(patch, "serviceTime") ? patch.serviceTime : order.serviceTime,
    warnings: warnings,
    status: patch.status
  };
}

function reconcileCpuWarningsAfterQuoteRead_(existingWarnings, parserWarnings, parsedData, order) {
  const hasItems = Boolean(parsedData && (parsedData.items || []).length);
  const hasPax = Boolean(
    (parsedData && Number(parsedData.pax)) ||
    (order && Number(order.pax))
  );
  const resolvedWarning = function(warning) {
    const text = String(warning || "").toLowerCase();
    if (hasItems && (
      text.indexOf("no menu items") !== -1 ||
      text.indexOf("quote attachment") !== -1 ||
      text.indexOf("quote link") !== -1 ||
      text.indexOf("quote could not") !== -1 ||
      text.indexOf("quote is not shared") !== -1 ||
      text.indexOf("quote format") !== -1 ||
      text.indexOf("booking form") !== -1
    )) return true;
    return hasPax && text.indexOf("pax could not be read") !== -1;
  };

  const combined = (existingWarnings || [])
    .concat(parserWarnings || [])
    .filter(function(warning) { return !resolvedWarning(warning); })
    .map(function(warning) { return String(warning || "").trim(); })
    .filter(Boolean);

  return combined.filter(function(warning, index) {
    return combined.indexOf(warning) === index;
  });
}
