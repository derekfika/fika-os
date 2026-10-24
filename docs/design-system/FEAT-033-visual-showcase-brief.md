# FEAT-033 — Visual Component Showcase Brief

- **Status:** Preparation brief for owner and Karol review; no production components or app styles changed.
- **Reference baseline:** `origin/main` at `8eee9adb1bba42326e5635ab65af6bdec797a015` (includes merged FEAT-033 audit/proposal PR #27).
- **Purpose:** Turn the existing FIKA OS Style Guide and tokens into reviewable visual reference material before any shared component implementation.
- **Scope:** Read-only inspection of repository brand sources and current app components. Measurements below are either existing standards/tokens or are explicitly marked for decision; this brief does not approve new design values.

## 1. Reference inventory

### Governing material

| Source | Finding | Use in the showcase |
| --- | --- | --- |
| `docs/STYLE-GUIDE.md` | Authoritative target for brand, hierarchy, accessibility, density, shell dimensions and interaction patterns. It gives button heights as 40–44px standard, 32–36px compact and 48px large; card radii 12–14px; modal radii 16–20px; normal rows 44–52px and compact desktop rows 36–44px. | Label these as written guide targets. Where token values do not resolve the range, show the conflict as an approval item rather than choosing silently. |
| `shared/fika/tokens.css` | Existing canonical shared token sheet; no shared React UI component package exists in `shared/fika`. | Use its exact values below. Do not edit tokens in this preparation task. |
| `docs/design-system/FEAT-033-audit-and-proposal.md` | Merged PR #27 audit and proposal. It recommends `packages/fika-ui`, supported density variants and a non-production showcase. Some dimensions in its proposed component contracts are proposals, not current approved token facts. | Preserve it as prior proposal history; visually distinguish current source facts from proposed values needing approval. |
| `apps/events-dashboard/docs/brand-foundation.md` | Names the approved FIKA logo/font source files and records logo, typography and accessibility guidance. It references a brand-guidelines PDF by name. | Use as corroborating brand evidence, while recording files not actually present in this repository as unresolved source provenance. |

### Approved brand assets and fonts found

- The repository contains `assets/logos/fika_logo_white_png.png`; the Events foundation identifies it as an approved, unchanged white FIKA logo. Show it only on a suitable dark-purple brand sample, without recolouring or distortion.
- `assets/logos` also contains `FIKA logo with slogan (1).png`, `FIKA logo with slogan (2).png`, `bloom.png`, `bloom-white.png`, `1ls.png` and a Cameo PDF. Their inclusion in the folder does not establish which are approved for product UI. Keep them off the canonical board until Karol confirms intended use and source.
- `apps/events-dashboard/docs/brand-foundation.md` names `Fika Brand Guidelines v1.0 (1).pdf`, but that PDF was not found in the repository asset inventory. The brief therefore relies on the checked-in Style Guide and records the original guideline file location/provenance as a review question.
- The documented interface pairing is **FIKA Vim Heavy** for short display headlines and **FIKA Gilroy** for interface text. The Events foundation names `VimSM.otf` plus Gilroy Regular, Medium, Semibold and Bold under `C:\FIKA\assets\fonts`.
- App-local copies/filenames are inconsistent: Events and Logistics have Gilroy weight files and `VimSM.otf`; several other apps carry Gilroy files and `Vim-Heavy.otf`; Hospitality also contains site-specific Avenir assets. These filename and weight differences require source/licence confirmation; do not infer that Avenir, Ubuntu or Superclarendon files elsewhere in `assets/fonts` are approved FIKA OS interface fonts.
- Menu Planning has `app/fonts.css` but no `public/fonts` directory in the inspected tree. Confirm its runtime font source before using it as a font-rendering reference; the shell remains a layout reference.

## 2. Strong existing component examples

These are exemplars to study, not evidence that the apps already share a canonical API. Active development surfaces and app-specific behavior remain owned by their apps.

| Component family | Strongest inspected example | What it demonstrates | Limits to carry into review |
| --- | --- | --- | --- |
| Buttons | Delivered-In `apps/delivered-in/app/grab-and-go-standing.css` | Purple primary, outlined secondary, destructive treatment, 44px minimum, disabled styling and semantic token use. | Standing Orders is under separate active work; reference only. Tertiary/text and loading contracts are not fully shared. |
| Text/number/search inputs | Hub `apps/integration-hub/app/globals.css`; Hospitality `apps/hospitality-booking/app/RcoaBookingPortal.module.css` | Hub uses labelled 44px controls and shared border/surface rules; Hospitality has scoped `:focus-visible` treatments across controls. | Hub has legacy `.primary` declarations with later overrides; Hospitality redefines some semantic tokens. Treat computed cascade and focus colour as app-specific until harmonised. |
| Selects | Hub global labelled `select` rules | Native selects, labels, border and shared control height form a clear baseline. | Other apps use 36–46px controls. Native select should remain default unless a verified platform limitation justifies custom behaviour. |
| Checkboxes | Hub native checkbox rules | Native keyboard semantics and brand-primary accent. | The visual box is 18px; enclosing target sizing varies and does not itself meet a touch-target contract. No shared switch example was found. |
| Modals/confirmation | Menu Planning `apps/menu-planning/app/planner-modal.tsx`; Hub `apps/integration-hub/app/ui/ConfirmationModal.tsx`; Logistics `apps/logistics/app/visit-chooser.tsx` | Menu Planning and Logistics show focus placement/trapping/restoration; Hub shows labelled/described confirmation and busy protection. | Focus and dismissal behavior differs; inspect busy-write safety, Escape and backdrop rules by workflow. Delivered-In also has a native `<dialog>` example, but native browser alert/confirm/prompt are prohibited for user-facing flows. |
| Status badges | Delivered-In standing-order `standing-chip-*` styles | Text-labelled semantic status colors and pill shape. | App-local implementation; check shared status token contrast, label clarity and whether status remains understandable without color. |
| Cards/panels | Menu Planning day cards and Delivered-In standing-order sections | Light grouped surfaces with clear operational content. | Radius and shadow vary; use cards as examples of content grouping, not as proof of a shared exact radius. |
| Tables | Hub `.table-wrap`; CPU production table styles | Hub has bounded horizontal scrolling/sticky headers; CPU converts rows into labelled small-screen content. | Responsive scroll versus reflow is a content-specific choice. Dense operational controls must retain keyboard and touch usability. |
| Toasts/errors | Logistics driver undo notice; duplicated `AdmissionError` components in Menu Planning and Logistics | Live status announcement/actionable undo and a reusable recovery-message pattern. | The duplicated admission components differ in tokens, type, radius and shadows; no canonical shared toast was found. |
| Loading/empty | CPU `production-empty`; Menu Planning loading/import progress states | Clear distinction between an empty operational period and a long-running operation. | Keep app-specific data meaning; shared presentation must not mask unavailable, stale or failed data as empty. |
| Navigation | Menu Planning `menu-planning-shell.tsx` / `shell.css` | Style Guide reference shell: 190px desktop sidebar and 82px header; links expose current-page semantics. | Do not generalise its information architecture or planner-specific context controls into a shared shell. |

## 3. Exact token and typography map

The values in this table are present in `shared/fika/tokens.css`; they are not new proposals. CSS values are listed as authored and with common pixel equivalents (assuming the browser default 16px root size).

| Token(s) | Existing value | Intended showcase use |
| --- | --- | --- |
| `--color-brand-primary`, `--fika-action-primary` | `#4f34c7` | FIKA purple; primary action/active emphasis. |
| `--fika-action-primary-hover` | `#3f27a8` | Existing primary hover token. |
| `--color-brand-dark`, `--fika-action-secondary` | `#280f8c` | Dark-purple brand accent/strong emphasis; secondary action alias. |
| `--color-brand-orange`, `--fika-focus-ring` | `#ff5c00` | Restrained accent and shared focus ring. |
| `--color-brand-yellow` | `#ffe800` | Accent/highlight surface with dark text, not ordinary text. |
| `--color-brand-turquoise` | `#4df7c2` | Accent/pale surface; not normal text on white. |
| `--color-brand-green` | `#50d700` | Accent/success surface; use semantic status green for text. |
| `--fika-surface-page` | `#f7f5f0` | Default pale page canvas. |
| `--fika-surface-card` | `#fff` | Card/control surface. |
| `--fika-surface-subtle` | `#f4f1fb` | Pale grouping/secondary surface. |
| `--fika-border-default` | `#dcd6ea` | Neutral boundary. |
| `--fika-text-primary`, `--fika-text-secondary`, `--fika-text-muted` | `#24163b`, `#665d73`, `#756b84` | Primary, secondary and muted text; validate contrast on actual surface. |
| `--fika-status-success` / `*-surface` | `#267a44` / `#eaf8ee` | Success text/icon and background. |
| `--fika-status-warning` / `*-surface` | `#8a4d00` / `#fff4db` | Warning/review text and background. |
| `--fika-status-danger` / `*-surface` | `#a22f43` / `#fff0f2` | Error/destructive text and background. |
| `--fika-status-info` / `*-surface` | `#3e2aa7` / `#efecff` | Informational text and background. |
| `--fika-font-display`, `--fika-font-body` | aliases for `"FIKA Vim", sans-serif` and `"FIKA Gilroy", sans-serif` | Display headline / working interface font. The font files and weights actually loaded by each app need provenance review. |
| `--text-xs`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl` | `.75rem`, `.875rem`, `1rem`, `1.25rem`, `1.75rem` = 12, 14, 16, 20, 28px | Existing type-size scale. Guide's 13px helper, 22px section and 32px page heading are not represented by named size tokens. |
| `--space-1`…`--space-7` | `.25`, `.5`, `.75`, `1`, `1.5`, `2`, `3rem` = 4, 8, 12, 16, 24, 32, 48px | Existing spacing scale. Style Guide additionally calls for 40 and 64px; no matching shared token exists. |
| `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` | `.5`, `.875`, `1.25rem`, `999px` = 8, 14, 20px, pill | Control radius, card radius candidate, larger overlay radius and pill. See conflicts below. |
| `--control-height`, `--fika-control-height` | `2.75rem` = 44px | Existing standard/touch control-height alias. No compact or large control-height token exists. |
| `--shadow-sm`, `--shadow-md` | `0 4px 16px rgba(40,15,140,.07)`; `0 14px 38px rgba(40,15,140,.14)` | Existing elevation tokens; Style Guide reserves stronger elevation for dialogs/transient overlays. |
| `--layout-wide`, `--layout-reading` | `94rem` (1504px), `72rem` (1152px) | Existing max-width references; shell guide targets content up to 1200px for operational work and up to 1500px only for genuinely wide views. |

### Existing standards and conflicts to show on the board

- **Control height:** shared token is exactly 44px. The Style Guide permits a standard range 40–44px, compact 32–36px and large 48px. The merged proposal selected 44px standard, 36px compact and 44px touch; those exact proposals do not add tokens and should remain marked “proposed” until approved.
- **Radii:** tokens offer 8/14/20px; guide says controls 8px, cards 12–14px and modals 16–20px. A card can use the existing 14px token. Modal 20px is available; 16px is a guide-permitted value but has no shared token. Do not silently add 12px or 16px radius aliases.
- **Spacing:** tokens cover 4/8/12/16/24/32/48px; guide also names 40/64px. Dialog form guidance additionally uses 6–8px label gap, about 16px between fields, 20–24px before footer. The exact 6, 20 and 40/64 values are not all represented in the shared scale.
- **Typography:** the Guide's 13px helper and 22/32px headings are not named in the current scale. Its suggested line heights (e.g. 14/20 body) are prose, not tokens. Use the guide as written; do not claim the token scale fully encodes it.
- **Semantic state variants:** semantic status foreground/surface tokens exist. There are no dedicated shared tokens for disabled controls, pressed states, tertiary foreground, neutral badge, selected-field fill or loading animation.
- **Motion and focus:** focus colour token exists; 3px outline/2px offset comes from the merged proposal rather than a token. Reduced motion is required by the Guide but has no dedicated motion token.
- **Shell geometry:** guide target is 190px sidebar/84px header; Menu Planning's 190px/82px observed shell is within guide tolerance. Hub's 220px/88px is a local deviation, not a reason to change its shell in this task.

## 4. Showcase specification for review

The board is a **review instrument**, not a declaration that every proposed cell is approved. Every specimen must carry one of these source labels: `Existing token/guide`, `Observed app example`, `Proposal — approval needed`, or `Unresolved`. Show its source file and exact token names beside the specimen.

### Component families and state matrix

| Family | Board specimens | Standard / compact / touch treatment | States to show |
| --- | --- | --- | --- |
| Buttons | Primary, secondary, tertiary/text, destructive, icon-only with accessible name | Standard uses the existing 44px token as the reference. Compact is desktop-dense only and shown at the guide's 32–36px range as a *range pending exact choice*. Touch target is at least 44px per guide. Do not set new padding/radius values until approved. | Rest, hover, keyboard focus-visible, active/pressed, disabled, loading/busy. Show loading label and duplicate-submit protection as behaviour annotation. |
| Text/number/search fields | Label + control + helper; required, optional and search affordance examples | 44px shared standard/touch reference; compact only shown as a proposed desktop density with exact height pending review. Keep visible label and generous target wrapper where control itself is compact. | Rest, hover, focus, filled, disabled, error/`aria-invalid`, helper, loading/async validation if applicable. |
| Selects | Native single select, native multi-select only if actual platform pattern requires; custom listbox as a labelled future option, not default | Same height references as inputs; do not imply custom listbox is approved. | Rest, open/focused, selected option, disabled, error; annotate keyboard/platform-native behavior. |
| Checkbox and switch | Native checkbox with label; separate switch specimen only as a proposed semantic pattern | Show actual Hub 18px checkbox as observed; the touch label row should meet the Guide's approx. 44px target. Switch dimensions remain undecided. | Unchecked, checked, indeterminate where used, focus, disabled; for switch, on/off must have semantic state and text where operationally useful. |
| Date control | Single date and range fields, using UK-facing example labels | 44px shared control reference; responsive range fields stack on narrow boards. Keep actual value semantics/domain date rules outside visual spec. | Empty, selected, focus, disabled, invalid/incomplete range, loading/unavailable annotation where the owning app uses async dates. |
| Dialog/confirmation | Small confirmation (~420px), standard form (~560px), large review (~760px) per Style Guide | Show viewport safe margins; board labels widths as guide values (“around”), not new exact token dimensions. Use 20px radius only as a token-backed specimen; show 16px only as an unresolved guide-permitted variant. | Rest, destructive consequence, validation error, saving/busy, disabled action, keyboard focus order and safe dismiss annotation. |
| Status badges | Success, warning/review, danger, info and neutral only if neutral semantics are agreed | Pill token exists. Height/padding are not token-defined; use observed badge as reference and mark any proposed sizing. | Each semantic meaning with text and optional decorative icon; selected/focus only if the badge is interactive. |
| Cards/panels | Default light surface, subtle grouping, interactive link/card, raised overlay example | Show card surface and 14px radius token. Padding and compact density are proposal/observed values, not currently component tokens. Touch behavior applies to interactive control, not card padding alone. | Rest, hover/focus/selected for interactive; disabled only if a real disabled-card use exists; loading/error/empty content examples. |
| Tables/lists | Standard operational rows, compact desktop rows, numeric values, responsive scroll/reflow | Guide ranges: standard 44–52px; compact desktop 36–44px. No row-height token exists. Touch row actions maintain approx. 44px targets even if text rows are denser. | Header, hover, selected row if applicable, disabled action, loading skeleton/progress, empty, error and horizontally bounded responsive treatment. |
| Toasts/notices/errors | Inline success/info, warning/review, blocking error with recovery action, short toast | Spacing/dimensions remain unspecified by tokens; use actual notice references and label any proposal. | Success, pending, error, dismissible/non-dismissible as safe; role/live-region and recovery action annotation. |
| Loading/empty/unavailable | Inline loading, determinate progress, intentional empty, unavailable, error | Use typography/spacing tokens; do not add new spinner or panel sizes without approval. | Clear visible copy and semantic announcement. Explicitly contrast empty vs loading vs unavailable. |
| Navigation | Sidebar item, header action, active tab/navigation link | Desktop shell reference: 190px sidebar, 84px header target; links/actions retain touch target guidance. Compact shell details need explicit density review. | Rest, hover, focus, active/current, disabled only where navigation can truly be unavailable; narrow-screen collapsed navigation retains current-page label. |

For all families, the reviewed API should expose only approved semantic variants; apps must not pass arbitrary color, font, radius, shadow or height values. Domain layouts may compose these parts for dense timelines and touch-led kitchen workflows without changing the shared visual language.

## 5. Visual mockup board layout

Create a single light-canvas board for joint review, with companion narrow-width frames. This is a layout specification only; no mockup has been generated in this task.

1. **Header strip:** “FIKA OS component family — review draft”, baseline date/SHA, owner/Karol review status, and legend for the four source labels above. Place the documented white logo only on a small purple swatch if it reads legibly; keep unconfirmed logo variants out.
2. **Token rail:** existing semantic color swatches with token names and hex values; font samples for the documented Vim display/Gilroy interface roles; type-size and spacing scales; radius samples 8/14/20/pill; control height 44px. Add visible callouts for guide/token gaps (40/64 spacing, 13/22/32 type sizes, compact height, modal 16px).
3. **Interaction board:** a consistent component grid in the family order above. Each state row is aligned so reviewers can compare hover/focus/active/disabled/loading/error/selected behavior across controls. Mark non-applicable states rather than omitting them silently.
4. **Density and device strip:** side-by-side standard, compact desktop and touch-target examples. Compact examples include a nearby 44px equivalent/target overlay so the review cannot mistake a small visual control for a permitted small touch target. Show 768px tablet and 390px narrow frames; these are review frame widths, not new responsive breakpoints.
5. **Operational context panels:** one small table, a form, a confirmation dialog, a status/notice cluster and sidebar/header sample using light surfaces and real labels. Keep content fictional and inert. No business workflow or data mutation should be implied.
6. **Evidence footer:** source component/file, tokens used, existing-vs-proposed status, accessibility notes (contrast, focus, keyboard, target), and unresolved decision ID for each panel.

Review the family together on the same board before approving individual implementation slices. This makes typography, action hierarchy, radii, spacing and state contrast comparable rather than judging each control in isolation.

## 6. Recommended architecture and first adoption slice

The merged PR #27 proposal recommends `packages/fika-ui` layered on `shared/fika/tokens.css`, imported directly by React apps and namespaced/CSS-module based. Keep shells, application navigation structure, forms/domain models and operational workflows in their owning apps. A non-production showcase should consume the same package exports and tokens but remain outside production routes/deployments. CI safeguards should begin with token/import rules and a small lint inventory for raw colors and duplicate primitive selectors, then expand only after false positives and compatibility aliases are understood.

**Recommended first implementation slice after approval:** Menu Planning shell `SidebarItem`/top-level navigation link only, preserving its existing shell dimensions and route/current-page semantics. Exclude `PlanningContextNav`, week/day planner controls, editor, save and publication actions. This surface is outside the excluded active Ad-hoc, CPU and Logistics work, does not touch Delivered-In's active Standing Orders UX work, and aligns with the Style Guide's current shell reference. Confirm the workspace lease before implementation; do not infer current task ownership from this audit.

Adopt the first primitive behind an app-local adapter/CSS layer so package rollout can be staged independently. Do not extract every observed component at once. Establish a visual contract and accessibility tests for one primitive, compare in the showcase, then migrate one low-risk shell surface before expanding to buttons and fields.

## 7. Unresolved creative and governance decisions

1. **Karol/owner — source assets:** Where is the authoritative Fika Brand Guidelines PDF? Confirm which slogan-logo variants are approved for product UI, whether a standalone purple logo exists, and whether a compact app/favicon mark is approved. No new logo treatment is proposed here.
2. **Karol/owner — font source:** Confirm the canonical Vim font file (`VimSM.otf` versus app copies named `Vim-Heavy.otf`), source/licensing and canonical Gilroy weight files. Confirm the runtime font-loading source for Menu Planning.
3. **Karol/owner — control sizes:** Choose exact standard and compact heights inside the Style Guide ranges, and decide whether the 44px control token is mandatory for every standard control. Confirm icon-button dimensions, compact hit-area spacing, checkbox visual size and whether a switch is in the initial scope.
4. **Karol/owner — radii/spacing/type tokens:** Decide whether guide-valid 12px card/16px dialog radii should be tokenized or the existing 14px/20px tokens should be the only choices. Decide how 40/64px spacing and 13/22/32px type sizes should be represented, if at all.
5. **Karol/owner — states:** Confirm disabled and selected treatments, tertiary action treatment, neutral status treatment, pressed/loading motion and whether selected table/card states need an explicit non-color marker. No new colors are supplied by this brief.
6. **Owner — component package:** Approve or revise `packages/fika-ui`, its ownership/versioning model and app dependency boundaries before implementation. Preserve independent app deployments.
7. **Owner/Karol — pilot:** Confirm Menu Planning top-level SidebarItem as the first slice and ensure no new active lease conflicts when implementation begins.

## 8. Review boundary

This brief records existing evidence and questions. It does not establish a final visual language, approve new token values, implement shared components, alter application styles, or authorize a cross-app migration. Style Guide compliance: **PASS** for this documentation-only preparation; no UI surface was changed.
