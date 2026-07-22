const CPU_CONFIG = Object.freeze({
  APP_NAME: "CPU Production",
  BUILD: "2026.06.21.9",
  FIKA_LOGO_URL: "https://bloom-coffee.org/bloom-quiz/assets/images/fika_logoRGB.png",
  FIKA_LOGO_SVG: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1726 740" role="img" aria-label="Fika logo"><path fill="#4F34C7" fill-rule="evenodd" d="M429 0L0 0L0 729L132 729L133 428L395 428L395 296L132 295L132 133L429 132ZM492 194L492 729L624 729L624 194ZM492 0L492 132L624 132L624 0ZM687 0L687 729L820 729L937 573L1054 729L1221 729L1020 462L1221 194L1055 194L820 507L819 0ZM1259 266L1241 286L1222 312L1213 327L1197 361L1187 392L1181 422L1179 441L1179 483L1183 514L1189 539L1203 577L1216 602L1231 625L1247 645L1273 671L1308 697L1346 717L1380 729L1419 737L1441 739L1469 739L1489 737L1518 731L1539 724L1559 715L1584 700L1599 688L1601 692L1603 729L1725 729L1725 194L1603 194L1601 232L1599 236L1587 226L1563 211L1544 202L1518 193L1496 188L1470 185L1440 185L1412 188L1373 197L1346 207L1325 217L1293 237ZM1450 317L1473 318L1500 324L1525 335L1547 350L1568 371L1585 397L1594 419L1600 449L1600 475L1593 508L1581 534L1567 554L1547 574L1530 586L1515 594L1489 603L1458 607L1432 605L1406 598L1383 587L1362 572L1345 555L1329 532L1317 504L1311 473L1312 442L1317 420L1329 392L1345 369L1368 347L1396 330L1422 321Z"/></svg>',
  DATA_SHEET: "CPU Orders",
  DELIVERY_SHEET: "CPU Deliveries",
  SETTINGS_SHEET: "CPU Settings",
  SCAN_LOG_SHEET: "CPU Scan Log",
  PREP_PHOTO_FOLDER_NAME: "CPU Prep Photos",
  DEFAULT_LOOKBACK_DAYS: 14,
  DEFAULT_LOOKAHEAD_DAYS: 56,
  CALENDAR_PAGE_SIZE: 250,
  SCAN_CHUNK_EVENTS: 20,
  SCAN_JOB_TTL_SECONDS: 21600,
  CACHE_SECONDS: 180,
  STATUS: {
    READY: "READY",
    NEEDS_ATTENTION: "NEEDS_ATTENTION",
    CANCELLED: "CANCELLED"
  },
  ORDER_HEADERS: [
    "OrderKey", "CalendarId", "CalendarEventId", "CalendarEventUrl",
    "SiteId", "SiteName", "SiteCode", "SiteColour",
    "StartAt", "EndAt", "EventDate", "DeliveryTime", "ServiceTime",
    "ClientCompany", "ServiceType", "Pax", "Location", "Floor", "HostName",
    "Notes", "Dietary", "ItemsJSON", "QuoteUrl", "QuoteName",
    "BookingFormUrl", "BookingFormName", "AttachmentCount",
    "Status", "WarningsJSON", "SourceUpdatedAt", "ScannedAt", "RawJSON", "EventOwnerEmail",
    "ChangesJSON", "ChangedAt", "Prepped", "PreppedAt", "PreppedBy",
    "PrepPhotoFileId", "PrepPhotoUrl", "PrepPhotoAt",
    "AllergenPhotoFileId", "AllergenPhotoUrl", "AllergenPhotoAt",
    "PrepPhotosJSON", "AllergenPhotosJSON"
  ],
  DELIVERY_HEADERS: [
    "DeliveryKey", "CalendarId", "CalendarEventId", "CalendarEventUrl",
    "EventDate", "StartAt", "EndAt", "Summary", "Description", "Location",
    "SiteId", "SiteName", "SiteCode", "SiteColour", "EventOwnerEmail",
    "SourceUpdatedAt", "ScannedAt", "DriverEmail", "DriverName", "DriverColour"
  ],
  DEFAULT_SETTINGS: {
    APP_NAME: "CPU Production",
    CALENDARS_JSON: "[{\"id\":\"cpux@fikacatering.com\",\"name\":\"CPU Hospitality Calendar\"}]",
    SITES_JSON: "[]",
    PRODUCT_CATEGORIES_JSON: "[]",
    SCAN_LOOKBACK_DAYS: "14",
    SCAN_LOOKAHEAD_DAYS: "56",
    DEEP_SCAN_MODE: "FALSE",
    SHOW_UPDATED_FLAGS: "FALSE",
    PREP_PHOTO_FOLDER_NAME: "CPU Prep Photos",
    AUTO_SCAN_ON_LOAD: "FALSE"
  }
});

const CPU_DRIVER_DIRECTORY = Object.freeze([
  { email: "francesco@fikacatering.com", name: "Francesco", colour: "#4F34C7" },
  { email: "dee@fikacatering.com", name: "D'Angelo", colour: "#EF6C35" }
]);

var CPU_RUNTIME_SETTINGS_CACHE = null;
var CPU_RUNTIME_SITES_CACHE = null;

const CPU_PRODUCT_CATEGORIES = Object.freeze([
  { id: "breakfast", name: "Breakfast", order: 10, keywords: ["bacon", "baked beans", "breakfast", "brioche", "croissant", "danish", "egg", "oats", "pastry", "pastries", "sausage", "yoghurt", "bagel", "pain au chocolat"] },
  { id: "working-lunch", name: "Sandwiches & Working Lunches", order: 20, keywords: ["deli", "sandwich", "working lunch", "baguette", "bap"] },
  { id: "salads", name: "Salads & Cold Bowls", order: 30, keywords: ["salad", "detox bowl", "protein bowl"] },
  { id: "hot-food", name: "Hot Food & Main Dishes", order: 40, keywords: ["tagine", "bulgogi", "brisket", "cooked chicken", "jacket potato", "ratatouille", "pulled chicken", "pie", "tonkatsu", "aubergine"] },
  { id: "soups", name: "Soups", order: 50, keywords: ["minestrone", "minestronie", "leek & potato", "roasted tomato & basil", "roasted wild mushroom", "spiced chickpea & coriander"] },
  { id: "canapes", name: "Canapés & Savoury Bites", order: 60, keywords: ["wellington", "tartlet", "frittata bite", "savoury bite"] },
  { id: "fruit", name: "Fruit", order: 70, keywords: ["fruit"] },
  { id: "sweet", name: "Cakes, Desserts & Sweet Treats", order: 80, keywords: ["cookie", "ice cream", "tray bake", "tray-bake", "cake", "sweet treat", "brownie", "dessert"] },
  { id: "staffing", name: "Staffing & Service", order: 90, keywords: ["chef", "event manager", "team member", "tema member", "front of house", "bar service", "kitchen porter", "staff"] },
  { id: "other", name: "Other Food & Drink", order: 100, keywords: [] },
  { id: "review", name: "Needs Review", order: 110, keywords: ["items at", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"] }
]);

const CPU_SITE_DIRECTORY = Object.freeze([
  { id: "seven@fikacatering.com", name: "Angel Court", code: "OAC", colour: "#4F34C7" },
  { id: "munichre@fikacatering.com", name: "Munich RE", code: "MR", colour: "#1F2F2F" },
  { id: "cfc@fikacatering.com", name: "CFC", code: "CFC", colour: "#1010FF" },
  { id: "regenthall@fikacatering.com", name: "Regent Hall", code: "RH", colour: "#B54C24" },
  { id: "nesta@fikacatering.com", name: "Nesta", code: "Nesta", colour: "#2878B8" },
  { id: "58ve@fikacatering.com", name: "58VE", code: "58VE", colour: "#7557C9" },
  { id: "zoom@fikacatering.com", name: "Zoom", code: "Zoom", colour: "#2D8CFF" },
  { id: "mnk@fikacatering.com", name: "MNK", code: "MNK", colour: "#7B5B32" },
  { id: "bridgepoint@fikacatering.com", name: "Bridgepoint", code: "BP", colour: "#315AA6" },
  { id: "fikax@fikacatering.com", name: "FIKA Xchange", code: "FIKAX", colour: "#E24A84" },
  { id: "cb@fikacatering.com", name: "Commerzbank", code: "CB", colour: "#D9A000" },
  { id: "fundingcircle@fikacatering.com", name: "Funding Circle", code: "FC", colour: "#7047EB" },
  { id: "optiver@fikacatering.com", name: "Optiver", code: "OPT", colour: "#009F85" },
  { id: "wgh@fikacatering.com", name: "Witan Gate House", code: "WGH", colour: "#A13D63" },
  { id: "isaias@fikacatering.com", name: "Isaias", code: "IS", colour: "#507B36" },
  { id: "dwayne@fikacatering.com", name: "Dwayne", code: "DW", colour: "#BB6428" }
]);

function getCpuSetting_(key, fallback) {
  const settings = getCpuSettingsMap_();
  if (!Object.prototype.hasOwnProperty.call(settings, key)) return fallback;
  const value = settings[key];
  return value === "" || value === null ? fallback : value;
}

function getCpuSettingsMap_() {
  if (CPU_RUNTIME_SETTINGS_CACHE) return CPU_RUNTIME_SETTINGS_CACHE;
  const sheet = ensureCpuSettingsSheet_();
  const lastRow = sheet.getLastRow();
  const settings = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(function(row) {
      const key = String(row[0] || "").trim();
      if (key) settings[key] = row[1];
    });
  }
  CPU_RUNTIME_SETTINGS_CACHE = settings;
  return settings;
}

function getCpuSites_() {
  if (CPU_RUNTIME_SITES_CACHE) return CPU_RUNTIME_SITES_CACHE;
  const raw = getCpuSetting_("SITES_JSON", "[]");
  let sites = [];
  try {
    sites = JSON.parse(String(raw));
  } catch (error) {
    throw new Error("CPU Settings > SITES_JSON is not valid JSON.");
  }

  const configured = Array.isArray(sites) ? sites : [];
  const configuredById = {};
  configured.forEach(function(site) {
    const id = String(site.id || site.calendarId || "").trim().toLowerCase();
    if (id) configuredById[id] = site;
  });

  const combined = CPU_SITE_DIRECTORY.map(function(defaultSite) {
    return Object.assign({}, defaultSite, configuredById[defaultSite.id] || {});
  });
  configured.forEach(function(site) {
    const id = String(site.id || site.calendarId || "").trim().toLowerCase();
    if (!id || CPU_SITE_DIRECTORY.some(function(defaultSite) { return defaultSite.id === id; })) return;
    combined.push(site);
  });

  CPU_RUNTIME_SITES_CACHE = combined
    .map(function(site, index) {
      return {
        id: String(site.id || site.calendarId || "").trim().toLowerCase(),
        name: String(site.name || site.siteName || "Site " + (index + 1)).trim(),
        code: String(site.code || site.shortCode || "S" + (index + 1)).trim(),
        colour: String(site.colour || site.color || cpuSiteColour_(index)).trim(),
        aliases: Array.isArray(site.aliases) ? site.aliases.map(String) : [],
        emails: Array.isArray(site.emails) ? site.emails.map(String) : []
      };
    })
    .filter(function(site) { return site.name; });
  return CPU_RUNTIME_SITES_CACHE;
}

function clearCpuRuntimeConfigCache_() {
  CPU_RUNTIME_SETTINGS_CACHE = null;
  CPU_RUNTIME_SITES_CACHE = null;
}

function getCpuProductCategories_() {
  const raw = getCpuSetting_("PRODUCT_CATEGORIES_JSON", "[]");
  let configured = [];
  try {
    configured = JSON.parse(String(raw || "[]"));
  } catch (error) {
    throw new Error("CPU Settings > PRODUCT_CATEGORIES_JSON is not valid JSON.");
  }
  const source = Array.isArray(configured) && configured.length
    ? configured
    : CPU_PRODUCT_CATEGORIES;
  return source.map(function(category, index) {
    return {
      id: String(category.id || "category-" + (index + 1)).trim(),
      name: String(category.name || category.label || "Category " + (index + 1)).trim(),
      order: Number(category.order) || (index + 1) * 10,
      enabled: category.enabled !== false,
      keywords: Array.isArray(category.keywords)
        ? category.keywords.map(function(keyword) { return String(keyword || "").trim().toLowerCase(); }).filter(Boolean)
        : []
    };
  }).filter(function(category) { return category.enabled && category.name; });
}

function getCpuCalendars_() {
  const raw = getCpuSetting_("CALENDARS_JSON", "");
  let calendars = [];

  if (String(raw).trim()) {
    try {
      calendars = JSON.parse(String(raw));
    } catch (error) {
      throw new Error("CPU Settings > CALENDARS_JSON is not valid JSON.");
    }
  }

  if (!Array.isArray(calendars) || !calendars.length) {
    calendars = getCpuSites_().filter(function(site) { return site.id; });
  }

  return (calendars || []).map(function(calendar, index) {
    return {
      id: String(calendar.id || calendar.calendarId || "").trim(),
      name: String(calendar.name || "CPU Calendar " + (index + 1)).trim(),
      defaultSiteName: String(calendar.defaultSiteName || calendar.siteName || "").trim(),
      defaultSiteCode: String(calendar.defaultSiteCode || calendar.siteCode || "").trim(),
      defaultSiteColour: String(calendar.defaultSiteColour || calendar.siteColour || cpuSiteColour_(index)).trim()
    };
  }).filter(function(calendar) { return calendar.id; });
}

function resolveCpuSite_(candidate, sourceCalendar, ownerEmail) {
  const value = String(candidate || "").trim();
  const normalised = normaliseCpuSiteText_(value);
  const owner = String(ownerEmail || "").trim().toLowerCase();
  const sites = getCpuSites_();

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const siteEmails = [site.id]
      .concat(Array.isArray(site.emails) ? site.emails : [])
      .map(function(email) { return String(email || "").trim().toLowerCase(); })
      .filter(function(email) { return email.indexOf("@") !== -1; });
    if (owner && siteEmails.indexOf(owner) !== -1) {
      return {
        id: site.id || owner,
        name: site.name,
        code: site.code,
        colour: site.colour
      };
    }
    const aliases = [site.name, site.code]
      .concat(Array.isArray(site.aliases) ? site.aliases : [])
      .map(normaliseCpuSiteText_)
      .filter(Boolean);
    if (aliases.some(function(alias) {
      return normalised === alias || normalised.indexOf(alias) !== -1 || alias.indexOf(normalised) !== -1;
    })) {
      return {
        id: site.id || normaliseCpuSiteText_(site.code || site.name).replace(/\s+/g, "-"),
        name: site.name,
        code: site.code,
        colour: site.colour
      };
    }
  }

  const fallbackName = value || owner || sourceCalendar.defaultSiteName || sourceCalendar.name || "Unassigned site";
  const fallbackCode = sourceCalendar.defaultSiteCode || cpuInitials_(fallbackName);
  return {
    id: normaliseCpuSiteText_(fallbackCode || fallbackName).replace(/\s+/g, "-"),
    name: fallbackName,
    code: fallbackCode,
    colour: sourceCalendar.defaultSiteColour || cpuSiteColour_(0)
  };
}

function getCpuSiteByOwnerEmail_(ownerEmail) {
  const owner = String(ownerEmail || "").trim().toLowerCase();
  if (!owner) return null;
  const sites = getCpuSites_();
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const emails = [site.id].concat(site.emails || [])
      .map(function(email) { return String(email || "").trim().toLowerCase(); });
    if (emails.indexOf(owner) !== -1) return site;
  }
  return null;
}

function normaliseCpuSiteText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(fika|floor|building|site|location)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cpuInitials_(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(function(part) { return part.charAt(0); })
    .join("")
    .slice(0, 4)
    .toUpperCase() || "SITE";
}

function cpuSiteColour_(index) {
  const colours = ["#4F34C7", "#EF6C35", "#168C72", "#C0447A", "#3376B8", "#8C6A2D"];
  return colours[index % colours.length];
}

function cpuBoolSetting_(key, fallback) {
  const value = String(getCpuSetting_(key, fallback ? "TRUE" : "FALSE")).toUpperCase();
  return value === "TRUE" || value === "YES" || value === "1";
}

function cpuNumberSetting_(key, fallback) {
  const value = Number(getCpuSetting_(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}
