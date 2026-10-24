// HTTP contract between Ad-Hoc Production and the Integration Hub.
//
// Pure types and constants only (no runtime dependencies), so the Ad-Hoc app can
// import it without bundling any Hub implementation. The Hub validates every
// request against these shapes server-side; Ad-Hoc never trusts the Hub's
// implementation details, only this wire format.

export const AD_HOC_HUB_API = {
  /** GET: the caller's identity (from the forwarded session); add `?oplocs=true` for the authorised OPLOC destinations. */
  access: "/api/ad-hoc-production/access",
  /** GET ?requestId= : authoritative order status. POST: send | cancel. */
  orders: "/api/ad-hoc-production/orders",
} as const;

/** The Hub authenticates the calling service with this header (never exposed to browsers). */
export const AD_HOC_SERVICE_TOKEN_HEADER = "x-fika-internal-token";

/** One canonical Production Order per Ad-Hoc request, independent of request version. */
export const adHocProductionOrderId = (requestId: string) => `production-order:v1:ad-hoc:${requestId}`;
/** Idempotency key for one request version. */
export const adHocSendKey = (requestId: string, requestVersion: number) => `adhoc-send:${requestId}:v${requestVersion}`;
/** Request-scoped identity of a one-off destination. It is never an OPLOC. */
export const adHocOneOffDestinationId = (requestId: string) => `adhoc-destination:${requestId}`;

export type AdHocProductionCategory = "delivered_in" | "fine_dining" | "hospitality" | "events" | "grab_and_go" | "other";

export type AdHocOrderLineInput = {
  /** Stable request line id; keeps CPU line identity (and evidence) across amendments. */
  sourceLineId: string;
  itemName: string;
  customerQuantity: number;
  customerUnit: string;
  productionQuantity: number;
  productionUnit: string;
  notes?: string;
};

export type AdHocOrderInput = {
  clientName: string;
  productionCategory: AdHocProductionCategory;
  serviceDate: string;
  deliveryDateTime: string;
  requiredBy: string;
  serviceWindow: { startTime: string; endTime?: string };
  /** An authorised OPLOC id (Hub re-validates and resolves aliases) or the request-scoped one-off identity. */
  destinationOplocId: string;
  requiresDelivery: true;
  deliveryLocation: string;
  /** Present only for one-off destinations. */
  destinationAddress?: { identity: string; label: string; address: string; deliveryInstructions?: string; contact?: string };
  contact?: string;
  serviceType: string;
  pax: number;
  priority: "normal";
  sourceReference: string;
  sourceEntityId: string;
  sourceVersion: number;
  stableSourceIdentity: true;
  notes?: string;
  lines: AdHocOrderLineInput[];
};

export type AdHocSendCommand = { action: "send"; requestId: string; requestVersion: number; idempotencyKey: string; order: AdHocOrderInput };
export type AdHocCancelCommand = { action: "cancel"; requestId: string; reason: string };

export type AdHocSendResult = {
  canonicalId: string;
  orderVersion: number;
  orderStatus: string;
  outcome: "created" | "amended" | "already_applied";
  /** Authoritative destination snapshot resolved by the Hub (OPLOC label/address come from Hub authority). */
  destination: { oplocId?: string; label: string; address?: string };
};
export type AdHocCancelResult = { canonicalId: string; orderStatus: string; outcome: "cancelled" | "already_cancelled" };
/** CPU -> Hub: reports that an Ad-Hoc order's signed allergen checker PDF exists, or has been withdrawn. */
export const AD_HOC_ALLERGEN_CHECKER_API = "/api/production/allergen-checker";
export type AdHocAllergenCheckerSigner = { role: "production_chef" | "head_chef_site_manager"; name: string };
export type AdHocAllergenCheckerReport = {
  canonicalId: string;
  state: "signed" | "withdrawn";
  releaseId: string;
  /** Monotonic CPU release version; the Hub ignores a report older than the one it holds. */
  releaseVersion: number;
  /** The order amendment revision the signature is bound to. A later order revision withdraws the checker. */
  sourceRevision: number;
  fileName?: string;
  driveUrl?: string;
  signedAt?: string;
  signers?: AdHocAllergenCheckerSigner[];
  reason?: string;
};
/** What the requester sees. A link is present only while the signed release is current. */
export type AdHocAllergenChecker = {
  state: "not_signed" | "signed" | "withdrawn";
  fileName?: string;
  driveUrl?: string;
  signedAt?: string;
  signers?: AdHocAllergenCheckerSigner[];
  reason?: string;
};
export type AdHocOrderStatus = { canonicalId: string; orderStatus: string; orderVersion: number; cancelled: boolean; allergenChecker?: AdHocAllergenChecker };

export type AdHocOploc = { canonicalId: string; label: string; address?: string; lifecycleStatus?: string };
export type AdHocAccess = {
  principal: { id: string; displayName?: string; email?: string };
  /** Present only when requested (`?oplocs=true`). */
  oplocs?: AdHocOploc[];
  redirects?: Record<string, string>;
};

/** Hub error body (shared Hub API shape). */
export type HubErrorBody = { error?: { code?: string; message?: string; requestId?: string; earliestDate?: string } };
