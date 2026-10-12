/**
 * Shared menu-artifact contracts. Kept free of runtime dependencies so the
 * allergen, format, layout and Slides modules can all import them without
 * creating import cycles with `menu-artifact.ts`.
 */

export type MenuWorkflow = "hospitality" | "delivered-in";

/**
 * Physical output formats. Content never changes between formats; only the
 * layout geometry, pagination and artifact identity do.
 *
 * `tent-label` is a first-class member of the contract: the supplied MNK label
 * template carries a fold-over tent page, so it is implemented alongside
 * `flat-label` (see `menu-formats.ts`).
 */
export type MenuOutputFormat = "tablet" | "flat-label" | "tent-label";

export const MENU_OUTPUT_FORMATS: readonly MenuOutputFormat[] = ["tablet", "flat-label", "tent-label"];
export const DEFAULT_MENU_OUTPUT_FORMAT: MenuOutputFormat = "tablet";

export type NormalizedMenuItem = {
  id: string;
  name: string;
  description?: string;
  /** Canonical allergen keys the dish contains (for example `tree_nuts`). */
  contains: string[];
  /** Canonical allergen keys the dish may contain. */
  mayContain: string[];
  /**
   * Allergen keys the source has not recorded. A dish with any of these is never
   * printable; this exists so the renderer can refuse it even if an adapter forgot to.
   */
  unrecorded?: string[];
  /**
   * True only when the owning workflow has POSITIVELY established that the dish has
   * no key allergens. An empty `contains`/`mayContain` without this is "unknown",
   * never "clear", and the dish is refused.
   */
  noKeyAllergens?: boolean;
};

export type NormalizedMenuSection = { key: string; label?: string; items: NormalizedMenuItem[] };

export type NormalizedMenu = {
  /** Site key, for example `mnk` or `angel-court`. */
  siteKey: string;
  siteLabel: string;
  oplocId?: string;
  /** UK business date, `YYYY-MM-DD`. */
  serviceDate: string;
  /** Optional `HH:mm` service time. */
  serviceTime?: string;
  title: string;
  serviceLabel?: string;
  sections: NormalizedMenuSection[];
  /** Overrides the derived file name where an owning workflow has a governed one. */
  fileName?: string;
  source: {
    workflow: MenuWorkflow;
    /** Stable source identity (booking id, published day id, ...). */
    id: string;
    /** Source revision/version that this menu represents. */
    version: string | number;
    /** Content/revision fingerprint so a changed menu at the same version is distinct. */
    revisionStamp?: string;
    clientName?: string;
  };
};

export class MenuArtifactError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "MenuArtifactError";
    this.code = code;
    this.status = status;
  }
}
