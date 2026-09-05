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
