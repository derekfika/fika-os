/**
 * Outbound-environment gate: a PURE DECISION HELPER for emails and Drive PDFs (issue #181).
 *
 * It decides, from server-verified inputs only, whether outbound mail/Drive traffic must pass
 * through unchanged (production), be redirected to an isolated staging inbox and Drive root
 * (staging), be blocked (local), or fail closed. It performs no I/O and reads no environment:
 * an adapter may read `process.env` only by passing values in explicitly.
 *
 * Trust boundary: every input (`mode`, `actualProjectId`, `actualServiceIdentity`, owner inbox,
 * Drive IDs) MUST come from server-verified runtime facts (deployment config, metadata server,
 * verified secret/config store). Never pass client flags, request hostnames, headers or
 * user-provided environment names.
 *
 * This module is NOT proof of effective runtime isolation. It does not enforce anything by
 * itself: Domain-Wide Delegation scopes, service-account IAM, Drive sharing and Gmail sender
 * permissions must be verified separately by the owner/admin. It ships no default inbox or
 * folder ID; the only literals are the expected project IDs below.
 *
 * Decisions are frozen and registered at creation; `applyStagingMailRouting` accepts only those.
 *
 * Local mode: outbound is BLOCKED (`kind: "local"`); local development never sends real mail or
 * writes real Drive files through this gate. Consumers decide how to simulate/log locally.
 *
 * All failures are `OutboundGateError` (retryable once configuration is corrected, no side
 * effects). Messages are fixed strings: they never echo configured values.
 */

export const STAGING_PROJECT_ID = "fika-os-dev";
export const PRODUCTION_PROJECT_ID = "fika-os";

export type OutboundGateErrorCode =
  | "OUTBOUND_UNKNOWN_MODE"
  | "OUTBOUND_PROJECT_MISMATCH"
  | "OUTBOUND_IDENTITY_MISMATCH"
  | "OUTBOUND_OWNER_INBOX_INVALID"
  | "OUTBOUND_DRIVE_CONFIG_INVALID"
  | "OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING"
  | "OUTBOUND_DRIVE_VERIFICATION_REQUIRED"
  | "OUTBOUND_LOCAL_BLOCKED"
  | "OUTBOUND_INVALID_DECISION";

const MESSAGES: Record<OutboundGateErrorCode, string> = {
  OUTBOUND_UNKNOWN_MODE: "Outbound routing is unavailable: the runtime mode is not recognised.",
  OUTBOUND_PROJECT_MISMATCH: "Outbound routing is unavailable: the runtime mode does not match the deployed project.",
  OUTBOUND_IDENTITY_MISMATCH: "Outbound routing is unavailable: the service identity does not belong to the deployed project.",
  OUTBOUND_OWNER_INBOX_INVALID: "Outbound routing is unavailable: the staging owner inbox is missing or invalid.",
  OUTBOUND_DRIVE_CONFIG_INVALID: "Outbound routing is unavailable: the staging Drive root or destinations are missing or invalid.",
  OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING: "Outbound routing is unavailable: staging overrides are not permitted outside staging.",
  OUTBOUND_DRIVE_VERIFICATION_REQUIRED: "Outbound routing is unavailable: staging Drive destinations are not verified as isolated from production.",
  OUTBOUND_LOCAL_BLOCKED: "Outbound mail and Drive writes are blocked in local mode.",
  OUTBOUND_INVALID_DECISION: "Outbound routing is unavailable: no valid routing decision was supplied.",
};

export class OutboundGateError extends Error {
  readonly retryable = true as const;
  constructor(readonly code: OutboundGateErrorCode) {
    super(MESSAGES[code]);
    this.name = "OutboundGateError";
  }
}

export interface StagingDriveDestinations {
  quotes?: string | null;
  menus?: string | null;
  allergenPdfs?: string | null;
}

/** All fields are server-verified runtime facts; see module doc. */
export interface OutboundGateInput {
  mode: string | null | undefined;
  actualProjectId: string | null | undefined;
  /** Runtime service-account email, e.g. `name@fika-os-dev.iam.gserviceaccount.com`. */
  actualServiceIdentity?: string | null;
  /** Staging only: the ONE verified owner inbox. */
  ownerInbox?: string | null;
  /** Staging only: isolated Drive root folder ID. */
  driveRootFolderId?: string | null;
  /** Staging only: Drive folder IDs under the staging root. */
  destinations?: StagingDriveDestinations | null;
  /**
   * Staging only, REQUIRED there. This module cannot itself prove a proof is TRUE: the trusted
   * server-side verifier/adapter must produce it by actually reading Drive `parents` and
   * ownership, and `approvedStagingRootFolderIds` must come from owner-controlled server
   * configuration, never from client input. The module only checks the proof is complete and
   * bound to the configured root.
   */
  driveVerification?: DriveVerification | null;
}

export interface DriveVerification {
  method: "staging-root-ancestry";
  /** Must equal `driveRootFolderId`. */
  rootFolderId: string;
  /** Non-empty server-config allowlist of owner-approved staging roots (exact IDs). */
  approvedStagingRootFolderIds: readonly string[];
  /** IDs the adapter proved (via Drive parents) are descendants of `rootFolderId`. */
  verifiedStagingChildIds: readonly string[];
}

export type OutboundDecision =
  | { kind: "production"; mail: "passthrough"; drive: "passthrough" }
  | { kind: "local"; mail: "blocked"; drive: "blocked" }
  | {
      kind: "staging";
      mailRecipient: string;
      drive: { root: string; quotes: string; menus: string; allergenPdfs: string };
    };

export type OutboundGateResult = { ok: true; decision: OutboundDecision } | { ok: false; error: OutboundGateError };

const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const SERVICE_NAME = /^[a-z][a-z0-9-]{3,28}[a-z0-9]$/;

const present = (value: unknown) => value !== undefined && value !== null;
const validEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && EMAIL.test(value) && !value.includes("..");
const validDriveId = (value: unknown): value is string => typeof value === "string" && DRIVE_ID.test(value);

function identityBelongsTo(identity: unknown, projectId: string): boolean {
  if (typeof identity !== "string") return false;
  const suffix = `@${projectId}.iam.gserviceaccount.com`;
  return identity.endsWith(suffix) && SERVICE_NAME.test(identity.slice(0, -suffix.length));
}

/** Any staging field present (even blank or empty) counts as an override. */
function hasStagingOverride(input: OutboundGateInput): boolean {
  return present(input.ownerInbox) || present(input.driveRootFolderId) || present(input.destinations) || present(input.driveVerification);
}

/** Decisions are only trusted if this module created them (forged or cloned objects are rejected). */
const issuedDecisions = new WeakSet<object>();
function issue<D extends OutboundDecision>(decision: D): D {
  if (decision.kind === "staging") Object.freeze(decision.drive);
  Object.freeze(decision);
  issuedDecisions.add(decision);
  return decision;
}

/** Pure. Throws `OutboundGateError` (fail closed) when the inputs cannot be trusted. */
export function decideOutboundRouting(input: OutboundGateInput): OutboundDecision {
  const mode = input?.mode;
  if (mode !== "local" && mode !== "staging" && mode !== "production") throw new OutboundGateError("OUTBOUND_UNKNOWN_MODE");
  const project = input.actualProjectId;

  if (mode === "local") {
    if (project === STAGING_PROJECT_ID || project === PRODUCTION_PROJECT_ID) throw new OutboundGateError("OUTBOUND_PROJECT_MISMATCH");
    if (hasStagingOverride(input)) throw new OutboundGateError("OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING");
    return issue({ kind: "local", mail: "blocked", drive: "blocked" });
  }

  if (mode === "production") {
    if (project !== PRODUCTION_PROJECT_ID) throw new OutboundGateError("OUTBOUND_PROJECT_MISMATCH");
    if (!identityBelongsTo(input.actualServiceIdentity, PRODUCTION_PROJECT_ID)) throw new OutboundGateError("OUTBOUND_IDENTITY_MISMATCH");
    if (hasStagingOverride(input)) throw new OutboundGateError("OUTBOUND_STAGING_OVERRIDE_IN_NON_STAGING");
    return issue({ kind: "production", mail: "passthrough", drive: "passthrough" });
  }

  // staging
  if (project !== STAGING_PROJECT_ID) throw new OutboundGateError("OUTBOUND_PROJECT_MISMATCH");
  if (!identityBelongsTo(input.actualServiceIdentity, STAGING_PROJECT_ID)) throw new OutboundGateError("OUTBOUND_IDENTITY_MISMATCH");
  if (!validEmail(input.ownerInbox)) throw new OutboundGateError("OUTBOUND_OWNER_INBOX_INVALID");
  const d = input.destinations;
  const root = input.driveRootFolderId;
  if (!validDriveId(root) || !d || !validDriveId(d.quotes) || !validDriveId(d.menus) || !validDriveId(d.allergenPdfs)) {
    throw new OutboundGateError("OUTBOUND_DRIVE_CONFIG_INVALID");
  }
  const ids = [root, d.quotes, d.menus, d.allergenPdfs];
  if (new Set(ids).size !== ids.length) throw new OutboundGateError("OUTBOUND_DRIVE_CONFIG_INVALID");
  const proof = input.driveVerification;
  const idList = (v: unknown): v is readonly string[] => Array.isArray(v) && v.length > 0 && v.every(validDriveId);
  if (
    !proof || typeof proof !== "object" || proof.method !== "staging-root-ancestry" ||
    proof.rootFolderId !== root ||
    !idList(proof.approvedStagingRootFolderIds) || !proof.approvedStagingRootFolderIds.includes(root) ||
    !idList(proof.verifiedStagingChildIds) ||
    ![d.quotes, d.menus, d.allergenPdfs].every((id) => proof.verifiedStagingChildIds.includes(id))
  ) {
    throw new OutboundGateError("OUTBOUND_DRIVE_VERIFICATION_REQUIRED");
  }
  return issue({
    kind: "staging",
    mailRecipient: input.ownerInbox,
    drive: { root, quotes: d.quotes, menus: d.menus, allergenPdfs: d.allergenPdfs },
  });
}

/** Non-throwing variant. Any unexpected failure is also reported as a fail-closed error. */
export function tryDecideOutboundRouting(input: OutboundGateInput): OutboundGateResult {
  try {
    return { ok: true, decision: decideOutboundRouting(input) };
  } catch (error) {
    return { ok: false, error: error instanceof OutboundGateError ? error : new OutboundGateError("OUTBOUND_INVALID_DECISION") };
  }
}

type Recipients = string | readonly string[] | null | undefined;

export interface OutboundMailMessage {
  to?: Recipients;
  cc?: Recipients;
  bcc?: Recipients;
  [field: string]: unknown;
}

export interface StagingMailRouting {
  redirected: true;
  /** Count only; original addresses are deliberately not retained. */
  originalRecipientCount: number;
}

export type RoutedMailMessage<M extends OutboundMailMessage> = Omit<M, "to" | "cc" | "bcc"> & {
  to: string[];
  cc: string[];
  bcc: string[];
  outboundRouting: StagingMailRouting;
};

const countRecipients = (r: Recipients) => (r === undefined || r === null ? 0 : typeof r === "string" ? (r.trim() ? 1 : 0) : r.length);

/**
 * Pure. Staging: To is REPLACED by the single owner inbox; CC/BCC are emptied; original recipients
 * are kept only as a count. Production: returns `message` unchanged (same reference). Local or an
 * invalid decision: throws.
 */
export function applyStagingMailRouting<M extends OutboundMailMessage>(
  decision: OutboundDecision | null | undefined,
  message: M,
): M | RoutedMailMessage<M> {
  if (!decision || typeof decision !== "object" || !issuedDecisions.has(decision)) throw new OutboundGateError("OUTBOUND_INVALID_DECISION");
  const keys = Object.keys(decision).sort().join(",");
  if (decision.kind === "production") {
    if (keys !== "drive,kind,mail" || decision.mail !== "passthrough" || decision.drive !== "passthrough") throw new OutboundGateError("OUTBOUND_INVALID_DECISION");
    return message;
  }
  if (decision.kind === "local") {
    if (keys !== "drive,kind,mail" || decision.mail !== "blocked" || decision.drive !== "blocked") throw new OutboundGateError("OUTBOUND_INVALID_DECISION");
    throw new OutboundGateError("OUTBOUND_LOCAL_BLOCKED");
  }
  const drive = (decision as { drive?: Record<string, unknown> }).drive;
  if (
    decision.kind !== "staging" || keys !== "drive,kind,mailRecipient" || !validEmail(decision.mailRecipient) || !drive ||
    Object.keys(drive).sort().join(",") !== "allergenPdfs,menus,quotes,root" || !Object.values(drive).every(validDriveId)
  ) throw new OutboundGateError("OUTBOUND_INVALID_DECISION");
  const { to, cc, bcc, ...rest } = message;
  return {
    ...rest,
    to: [decision.mailRecipient],
    cc: [],
    bcc: [],
    outboundRouting: { redirected: true, originalRecipientCount: countRecipients(to) + countRecipients(cc) + countRecipients(bcc) },
  };
}
