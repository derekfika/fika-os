export const productRoutes = {
  in_house: "In house",
  cpu_hospitality: "CPU · Hospitality",
  cpu_sandwiches: "CPU · Sandwiches",
  cpu_delivered_in: "CPU · Delivered-In",
} as const;

export type ProductRoute = keyof typeof productRoutes;
export type ProductEditorSite = {
  oplocId: string;
  label: string;
  active: boolean;
};
type Price = { amount: number; vatRate: number };

export type ProductEditorRow = {
  itemId: string;
  version: number;
  name: string;
  category: string;
  description: string;
  status: "active" | "archived";
  defaultPrice?: Price & { effectiveFrom: string };
  defaultMinimumQuantity?: number;
  routing: {
    state: ProductRoute | "routing_required" | "routing_conflict";
    version: number;
  };
  routingSuggestion?: { choice: ProductRoute; reason: string };
  defaultMode?: "standard" | "quote_only";
};

type ProductFields = { name: string; category: string; description?: string };
type ProductRules = {
  salesUnit?: string;
  indicativeFrom?: number;
  productionConversion?: { multiplier: number; unit: string };
};
export type ProductCommand =
  | (ProductFields & {
      action: "create-item";
      requestId: string;
      routing: ProductRoute;
      defaultPrice?: Price;
      defaultMinimumQuantity?: number;
      offeringMode?: "quote_only";
      minimumGuests?: number;
      noticeRequiredDays?: number;
      configuration?: { rules: ProductRules };
      oplocIds: string[];
      restrictToSelectedOplocs?: true;
    })
  | (ProductFields & {
      action: "update-item";
      itemId: string;
      expectedVersion: number;
      defaultMinimumQuantity: number | null;
      defaultPrice?: Price;
    })
  | {
      action: "set-routing";
      itemId: string;
      expectedRoutingVersion: number;
      routing: ProductRoute;
    }
  | {
      action: "set-item-status";
      itemId: string;
      expectedVersion: number;
      status: ProductEditorRow["status"];
    };

export type ProductSaveResult = {
  message: string;
  package: "published" | "unchanged" | "stale";
  rows: ProductEditorRow[];
};

export type ProductDetails = {
  name: string;
  category: string;
  description: string;
  price: string;
  vat: string;
  minimum: string;
};

export type ProductCreation = {
  route: ProductRoute | "";
  mode: "standard" | "quote_only";
  siteIds: string[];
  restrictToSites: boolean;
  minimumGuests: string;
  noticeDays: string;
  indicativeFrom: string;
  salesUnit: string;
  productionMultiplier: string;
  productionUnit: string;
};

const percent = new Intl.NumberFormat("en-GB", {
  useGrouping: false,
  maximumFractionDigits: 10,
});

export function productDetails(row: ProductEditorRow | null): ProductDetails {
  return {
    name: row?.name ?? "",
    category: row?.category ?? "",
    description: row?.description ?? "",
    price:
      row?.defaultPrice === undefined ? "" : String(row.defaultPrice.amount),
    vat:
      row?.defaultPrice === undefined
        ? "20"
        : percent.format(row.defaultPrice.vatRate * 100),
    minimum:
      row?.defaultMinimumQuantity === undefined
        ? ""
        : String(row.defaultMinimumQuantity),
  };
}

export function initialProductCreation(
  sites: readonly ProductEditorSite[],
): ProductCreation {
  return {
    route: "",
    mode: "standard",
    siteIds: sites.filter((site) => site.active).map((site) => site.oplocId),
    restrictToSites: false,
    minimumGuests: "",
    noticeDays: "",
    indicativeFrom: "",
    salesUnit: "",
    productionMultiplier: "",
    productionUnit: "",
  };
}

function decimal(value: string, label: string) {
  const numeric = Number(value.trim());
  if (
    !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ||
    !Number.isFinite(numeric)
  ) {
    throw new Error(label + " must be a non-negative number.");
  }
  return numeric;
}

function wholeNumber(value: string, label: string, minimum: number) {
  if (!value.trim()) return undefined;
  const numeric = decimal(value, label);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new Error(
      label + " must be a whole number of " + minimum + " or more.",
    );
  }
  return numeric;
}

function money(value: string, label: string) {
  const amount = decimal(value, label);
  if (Math.round(amount * 100) / 100 !== amount) {
    throw new Error(label + " can have at most two decimal places.");
  }
  return amount;
}

function priceInput(
  details: ProductDetails,
  original?: ProductEditorRow,
): Price {
  const amount = money(details.price, "Net price");
  // Preserve the original fractional rate when its display value is unchanged.
  const previous = original?.defaultPrice;
  if (previous && details.vat.trim() === productDetails(original ?? null).vat) {
    return { amount, vatRate: previous.vatRate };
  }
  const vat = decimal(details.vat, "VAT");
  if (vat > 100) throw new Error("VAT must be between 0 and 100 percent.");
  return { amount, vatRate: vat / 100 };
}

function productFields(details: ProductDetails): ProductFields {
  const name = details.name.trim();
  const category = details.category.trim();
  const description = details.description.trim();
  if (!name || !category)
    throw new Error("Enter the product name and category.");
  if (name.length > 240 || category.length > 160 || description.length > 4000) {
    throw new Error("Shorten the product name, category or description.");
  }
  return { name, category, ...(description && { description }) };
}

function productionRules(creation: ProductCreation): ProductRules {
  const salesUnit = creation.salesUnit.trim();
  const unit = creation.productionUnit.trim();
  if (salesUnit.length > 80 || unit.length > 80)
    throw new Error("Use 80 characters or fewer for each unit.");
  let productionConversion: ProductRules["productionConversion"];
  if (unit || creation.productionMultiplier.trim()) {
    if (!salesUnit || !unit || !creation.productionMultiplier.trim()) {
      throw new Error(
        "Enter the selling unit, production unit and quantity together.",
      );
    }
    const multiplier = decimal(
      creation.productionMultiplier,
      "Production quantity per selling unit",
    );
    if (multiplier <= 0 || multiplier > 10000) {
      throw new Error(
        "Production quantity per selling unit must be greater than 0 and at most 10,000.",
      );
    }
    productionConversion = { multiplier, unit };
  }
  const indicativeFrom =
    creation.mode === "quote_only" && creation.indicativeFrom.trim()
      ? money(creation.indicativeFrom, "Indicative starting price")
      : undefined;
  return {
    ...(salesUnit && { salesUnit }),
    ...(productionConversion && { productionConversion }),
    ...(indicativeFrom !== undefined && { indicativeFrom }),
  };
}

export function createProductCommand(
  details: ProductDetails,
  creation: ProductCreation,
  sites: readonly ProductEditorSite[],
  requestId: string,
): Extract<ProductCommand, { action: "create-item" }> {
  const fields = productFields(details);
  if (!creation.route) throw new Error("Choose a production route.");
  const oplocIds = [...new Set(creation.siteIds)];
  if (!oplocIds.length || oplocIds.length > 60)
    throw new Error("Choose between 1 and 60 active sites.");
  const activeIds = new Set(
    sites.filter((site) => site.active).map((site) => site.oplocId),
  );
  if (oplocIds.some((id) => !activeIds.has(id)))
    throw new Error("Choose only active sites.");
  const minimum = wholeNumber(details.minimum, "Minimum quantity", 1);
  const minimumGuests = wholeNumber(
    creation.minimumGuests,
    "Minimum guests",
    1,
  );
  const noticeRequiredDays = wholeNumber(
    creation.noticeDays,
    "Minimum notice",
    0,
  );
  const rules = productionRules(creation);
  return {
    action: "create-item",
    requestId,
    ...fields,
    routing: creation.route,
    oplocIds,
    ...(creation.restrictToSites && { restrictToSelectedOplocs: true }),
    ...(minimum !== undefined && { defaultMinimumQuantity: minimum }),
    ...(minimumGuests !== undefined && { minimumGuests }),
    ...(noticeRequiredDays !== undefined && { noticeRequiredDays }),
    ...(Object.keys(rules).length > 0 && { configuration: { rules } }),
    ...(creation.mode === "quote_only"
      ? { offeringMode: "quote_only" }
      : { defaultPrice: priceInput(details) }),
  };
}

export function updateProductCommand(
  details: ProductDetails,
  row: ProductEditorRow,
): Extract<ProductCommand, { action: "update-item" }> | null {
  const fields = productFields(details);
  const minimum = wholeNumber(details.minimum, "Minimum quantity", 1);
  const original = productDetails(row);
  const priceChanged =
    details.price.trim() !== original.price ||
    details.vat.trim() !== original.vat;
  if (
    (row.defaultPrice && !details.price.trim()) ||
    (priceChanged && !details.price.trim())
  ) {
    throw new Error(
      "Enter a net price for this change. The company price cannot be cleared here.",
    );
  }
  if (priceChanged && !row.defaultMode) {
    throw new Error(
      "The product booking mode is unavailable. Refresh the catalogue before changing the price.",
    );
  }
  const price = priceChanged ? priceInput(details, row) : undefined;
  const priceUpdate =
    price &&
    (price.amount !== row.defaultPrice?.amount ||
      price.vatRate !== row.defaultPrice?.vatRate);
  if (
    fields.name === row.name &&
    fields.category === row.category &&
    (fields.description ?? "") === row.description &&
    minimum === row.defaultMinimumQuantity &&
    !priceUpdate
  )
    return null;
  return {
    action: "update-item",
    itemId: row.itemId,
    expectedVersion: row.version,
    ...fields,
    defaultMinimumQuantity: minimum ?? null,
    ...(priceUpdate && { defaultPrice: price }),
  };
}

export function currentRoute(row: ProductEditorRow | null): ProductRoute | "" {
  if (
    !row ||
    row.routing.state === "routing_required" ||
    row.routing.state === "routing_conflict"
  )
    return "";
  return row.routing.state;
}

export function productReceipt(
  value: unknown,
  command: ProductCommand,
): ProductSaveResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<ProductSaveResult>;
  const row = result.rows?.[0];
  if (
    typeof result.message !== "string" ||
    !["published", "unchanged", "stale"].includes(result.package ?? "") ||
    !Array.isArray(result.rows) ||
    result.rows.length !== 1 ||
    !row ||
    typeof row.itemId !== "string" ||
    !row.itemId ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    typeof row.name !== "string" ||
    typeof row.category !== "string" ||
    typeof row.description !== "string" ||
    !["active", "archived"].includes(row.status) ||
    !row.routing ||
    !Number.isSafeInteger(row.routing.version)
  )
    return null;
  if (command.action === "create-item") return result as ProductSaveResult;
  if (row.itemId !== command.itemId) return null;
  if (command.action === "set-routing") {
    if (
      row.routing.version <= command.expectedRoutingVersion ||
      row.routing.state !== command.routing
    )
      return null;
  } else if (row.version <= command.expectedVersion) {
    return null;
  }
  if (command.action === "set-item-status" && row.status !== command.status)
    return null;
  return result as ProductSaveResult;
}
