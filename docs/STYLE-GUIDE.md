# FIKA OS Style Guide

Status: authoritative UI standard

Read this guide before changing a FIKA OS user-facing screen, component or interaction. It is a shared foundation, not a mandate to mass-restyle existing applications.

## Sources and scope

Approved brand source material is under `assets/`. The shared foundation is `shared/fika/tokens.css`; app-specific token files may alias it for compatibility. The Events Dashboard foundation in `apps/events-dashboard/docs/brand-foundation.md` records the approved Vim Heavy/Gilroy pairing and accessibility principles.

Use the smallest safe adoption surface. New UI must use the shared semantic vocabulary. Existing screens should be migrated only when directly in scope.

## Brand tokens

Raw brand values are reserved for brand expression, accents and surfaces:

| Token | Value | Guidance |
| --- | --- | --- |
| `--color-brand-primary` | `#4F34C7` | FIKA purple; primary actions and active emphasis |
| `--color-brand-dark` | `#280F8C` | dark-purple brand accent and strong headings |
| `--color-brand-orange` | `#FF5C00` | restrained accent, never default body text |
| `--color-brand-yellow` | `#FFE800` | highlight/accent surface with dark text |
| `--color-brand-turquoise` | `#4DF7C2` | accent or pale surface; not body text on white |
| `--color-brand-green` | `#50D700` | accent or success surface; use semantic green for text |

Prefer semantic tokens in components: `--fika-surface-page`, `--fika-surface-card`, `--fika-surface-subtle`, `--fika-text-primary`, `--fika-text-secondary`, `--fika-text-muted`, `--fika-border-default`, `--fika-action-primary`, `--fika-action-primary-hover`, `--fika-focus-ring`, and the `--fika-status-{success,warning,danger,info}` tokens with their `*-surface` counterparts.

Semantic text colours must be contrast-tested against their actual surface. Never use bright turquoise, lime green, yellow or orange as ordinary paragraph, label or table text on white or pale backgrounds.

## Typography

- Vim Heavy is for short, prominent display headlines and brand moments.
- Gilroy is the working interface face for navigation, labels, controls, body copy and operational data.
- Use system fallbacks while fonts load or when a font is unavailable.
- Suggested hierarchy: page title 32/40, section title 22/28, card title 16/22, body 14/20, helper 13/18, label/status 12/16, table text 13/18, buttons 14/20.
- Use weight and spacing for hierarchy; avoid long all-caps paragraphs and decorative treatments in dense operational views.

## Colour and accessibility

The default canvas is light: a pale page background, white/pale cards, soft neutral borders and dark text. Purple is the primary action and active-state colour. Green means success/matched/complete, amber means review/warning, and red is reserved for genuine errors or destructive actions. Every status also needs text or an accessible name; colour alone is not meaning.

Every interactive control needs visible `:focus-visible` styling. Aim for a minimum 44px touch target for primary controls, with a documented compact exception for dense desktop tables. Disabled controls must remain legible. Respect `prefers-reduced-motion`.

### Accessibility rules

- Normal text must meet a WCAG contrast ratio of at least **4.5:1**.
- Large text must meet at least **3:1**, using the WCAG definition of large text.
- Controls, focus indicators and meaningful graphical/UI boundaries must have appropriate visible contrast.
- Keyboard focus must be visible and every interactive workflow must be fully keyboard navigable.
- Inputs need proper visible labels and programmatic names. Placeholder text is not a label.
- Status and meaning must never rely on colour alone.
- Disabled text must remain readable.
- Primary touch targets should normally be approximately 44px or larger.
- Icon-only controls need screen-reader-accessible names.
- Respect the user’s reduced-motion preference.

Accessibility regressions are defects, not cosmetic differences.

## Hard-coded colour governance

New or materially changed user-facing components **must** use shared semantic FIKA OS tokens where an appropriate token exists. Do not introduce raw hexadecimal, RGB or HSL values in touched UI when an equivalent shared token exists.

Exceptions are limited to approved brand artwork/assets, controlled additional palette values required for data visualisation, third-party integration constraints, or a documented technical exception. The task return must explain any exception and identify the affected surface. `#4DF7C2` turquoise is a brand accent, **not** a default text colour.

## Canonical shell dimensions (target)

These are target standards for new and touched UI, not a migration mandate:

| Element | Target |
| --- | --- |
| Desktop sidebar | 190px |
| Collapsed/icon-only sidebar | 76px, where supported |
| Application header | 84px target; 82–86px acceptable |
| Desktop page gutters | 32px default; 24–56px responsive range |
| Mobile page gutters | 16px |
| Content width | `min(1200px, available width)` for operational work; up to 1500px only for genuinely wide dashboards/tables |

The Menu Planning shell is the current reference. Existing shells with other dimensions are technical debt for a future audit unless they cause unreadability, accessibility failure or broken interaction. Do not opportunistically migrate them.

## Layout foundations

Use the existing application shell, sidebar and header patterns. Keep stable reading widths with page gutters of 16px on small screens, 24px on tablet and 32–40px on desktop where the shell permits. Use the spacing rhythm 4, 8, 12, 16, 24, 32, 40, 48 and 64px. Use 8px controls, 12–14px cards, 16–20px modals and pill radius only for tags/chips.

Use no shadow or a very soft shadow for normal cards; reserve stronger elevation for dialogs and transient overlays. Do not use a full-bleed dark panel inside a light operational application.

## Standard components

### Shell, sidebar and header

The shell provides orientation, not decoration. Active navigation uses purple emphasis and an accessible current-state indicator. The header keeps product context and the primary action visible without competing with page content. On mobile, collapse secondary navigation without hiding the current location.

### Buttons and controls

Primary buttons use purple with white text. Secondary buttons use white/pale surfaces, a neutral border and dark/purple text. Destructive buttons use the danger semantic. Use 40–44px normal height, 32–36px compact height and 48px large height. Preserve loading and disabled states and never rely on a colour-only icon.

Inputs, selects and search fields use white cards, dark text, neutral borders, clear labels and an explicit error/helper line. Placeholder text is not a label.

### Cards and tables

Cards group one operational idea and should not become oversized empty containers. Tables use a clear header, readable row density, aligned numeric data, bounded scrolling and an empty state explaining the next action. Prefer restrained separators over heavy grids.

### Modals and feedback

Dialogs need a title, clear primary/secondary actions, keyboard focus management and an obvious close path. Success, warning, error and information must be announced appropriately and understood without colour. Errors explain recovery; destructive actions explain consequences.

### Empty, loading and error states

Differentiate no data, intentionally blank data, loading, unavailable, withdrawn and error. Do not replace an intentional blank operational day with a spinner or invented work. Loading indicators should be local and restrained. Error states preserve context and provide a safe next action.

### File upload and review

Upload areas are light cards with a visible drop target, a normal file-picker button, accepted-file guidance, keyboard access and a clear list of selected files. Review screens use compact rows, strong hierarchy and semantic status chips. Matched, review and error states are labelled in text and remain readable at normal zoom.

## Responsive behaviour

Design for keyboard, mouse, touch and narrow screens. At smaller widths, stack toolbars, allow tables to scroll or reflow, keep primary actions reachable and avoid horizontal page overflow. Preserve semantic order and meaning across breakpoints.

## Do and don't

| Do | Don't |
| --- | --- |
| Use shared semantic tokens and existing shell/button patterns. | Create one-off colour systems or a dark admin-console island. |
| Use purple for primary action and active emphasis. | Use turquoise, lime, yellow or orange as routine body text. |
| Pair status colour with words/icons and accessible names. | Encode success, warning or error by colour alone. |
| Keep cards calm, compact and proportionate to their content. | Use oversized cards, pale helper text or near-white headings. |
| Preserve visible keyboard focus and logical tab order. | Remove outlines or make focus indistinguishable from hover. |
| Document a justified deviation. | Perform an unrequested cross-app restyle. |

## Component-level adoption standard

For new or touched components, consume shared semantic tokens, use existing shell and control patterns, and add focused contract tests where a visual regression would affect usability or brand/accessibility. A task-specific deviation must state its reason and affected surface. UI changes are complete only when the relevant tests, typecheck and build have run and accessibility regressions are not introduced.

## Modal sizing and behaviour

Use these standard content widths; do not invent arbitrary modal widths:

- **Small:** around 420px.
- **Standard:** around 560px.
- **Large:** around 760px.
- **Wide/workspace:** only when the workflow genuinely requires it; bound it to the viewport with safe gutters.

Every modal must fit within the viewport, retain safe mobile margins, manage focus on open, return focus on close, support Escape when safe, provide a visible close/cancel action where appropriate, and use consistent footer alignment. Prevent accidental dismissal during unsafe committed writes. A modal that cannot be safely cancelled must say so plainly.

## Long-running operations

Any operation that takes longer than approximately an instant—such as workbook import, menu publication, packet generation, report export or bulk processing—must provide meaningful progress. Where data exists, show the current stage, completed count/total, current item and a progress bar or equivalent, using concise plain language.

Preferred stages include “Reading files”, “Checking dishes”, “Preparing menu weeks”, “Importing menu weeks” and “Done”. Do not expose implementation jargon such as “Firestore write”, “canonical-ID reconciliation”, “packet serialization” or “transaction replay”. During committed writes, prevent duplicate submission, disable the initiating action, do not allow unsafe cancellation, and tell the user to keep the page open when required. Success states show meaningful outcomes; failure states identify the affected item and offer a safe next action.

### Menu Planning importer reference

The Menu Planning importer is the reference long-running-operation pattern. Its checking state should show files checked/total, menu weeks found, menu days parsed, unique dish names, automatically matched names, names needing review and the current workbook. Its final import state should show weeks imported/total, current week, remaining weeks and **“0 new Dish Library items created”**. Completion should show menu weeks imported, dish names processed, automatic matches, reviewed mappings, ignored mappings where relevant and zero new dishes.

## Bulk actions

Bulk actions must state their scope, show the number of records affected, respect the active filter/selection, confirm destructive or irreversible actions, support undo where safe and practical, and surface important consequences. “Ignore all 255 shown” is preferable to “Ignore all”. For large lists, bulk-action and filter bars may remain sticky while scrolling.

## Operational density

- Normal list/table rows target roughly **44–52px**.
- Compact desktop rows target roughly **36–44px**.
- Allow more height when content genuinely requires it, but document the reason.

Discourage one huge card per record, excessive vertical whitespace, repeated search controls permanently expanded for every row, and multiple full-screen-height cards for simple review decisions. Prefer progressive disclosure: a compact default row with detail opened only when needed.

## Button precision

Use shared button variants rather than application-local equivalents:

| Variant | Standard |
| --- | --- |
| Primary | Semantic purple background, white text, Gilroy Semibold, 40–44px height, 14–18px horizontal padding, 8px radius, hover token, visible focus ring, loading state and readable disabled state; no arbitrary drop shadow |
| Secondary | White/pale surface, neutral border, dark or purple text, same height/radius/focus/loading/disabled rules |
| Tertiary/text | Transparent surface, strong text/icon affordance, clear hover and focus, reserved for low-emphasis actions |
| Destructive | Danger semantic, explicit consequence, confirmation where irreversible, never used for ordinary warnings |
| Compact | 32–36px height only for dense desktop contexts; preserve readable text, focus and target spacing |

Loading buttons must not accept a second submission. Disabled styling must retain readable text and an understandable state.

## Card and shadow precision

Default cards use a light surface, neutral border, standard radius and no shadow or a minimal shadow. Raised cards are reserved for genuine hierarchy. Modal and popover surfaces may use stronger elevation. Decorative heavy shadows are prohibited in routine operational UI.

## Target versus legacy rule

`docs/STYLE-GUIDE.md` defines the **target FIKA OS design system**. Existing non-compliant UI is technical debt unless it causes unreadability, accessibility failure, broken interaction, misleading state or severe inconsistency in an actively touched workflow. Touched UI must move toward compliance, never away from it. This guide does not authorize opportunistic mass restyling.

## Audit-ready compliance categories

Future read-only UI audits should classify findings under: Typography; Colour/contrast; Hard-coded colours; Buttons; Inputs; Cards; Tables/lists; Modals; Sidebar/shell; Page headers; Status/alerts; Empty/loading/error states; Accessibility; Responsive behaviour; Density; Long-running operations; and Bulk actions.

## Native browser dialogs

Do not use native browser dialogs in FIKA OS user-facing workflows:

- `window.alert()`
- `window.confirm()`
- `window.prompt()`

These are prohibited for normal application UX.

Use the FIKA OS modal/dialog standard instead.

Confirmation dialogs must:
- use shared semantic tokens/components
- clearly state the action and consequence
- show affected item/count where relevant
- use primary/secondary/destructive button hierarchy
- support keyboard focus management
- return focus to the invoking control
- be dismissible with Escape only when safe
- never rely on browser-native styling

Examples:

Instead of:
`confirm("Ignore all 137 shown names?")`

Use:
Title: `Ignore 137 dish names?`
Body: `These dishes will not be added to the imported menu weeks.`
Actions:
[Cancel] [Ignore 137 dishes]

Instead of:
`alert("Import failed")`

Use an application modal, inline error state or toast appropriate to the severity, with a clear recovery action.

EXCEPTION:
Native dialogs may be used only in non-user-facing developer/debug tooling, never in normal FIKA OS production workflows.
