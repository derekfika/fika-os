# FIKA OS Component Atlas — Direction B / FIKA Tactile

**Status:** Product owner-selected direction for **new** FIKA OS UI; incremental adoption only. **Marketing/Brand review:** new tactile treatments and exact proposed dimensions are pending Karol's approval. **Production migration:** not authorised by this document.
**Date:** 2026-10-31. **Scope:** FIKA OS internal operational UI; site/customer co-branding remains governed by its existing approvals.

## Source of truth (in precedence order)

1. **Fika Brand Guidelines v1.0** — official artwork, logo clearspace and permitted colour/typography.
2. [FIKA OS Style Guide](../STYLE-GUIDE.md) — binding UI, accessibility, density, responsive and interaction requirements.
3. [Canonical FIKA tokens](../../shared/fika/tokens.css) — exact approved values. Do **not** override/redefine their values.
4. This **Component Atlas** and [component reference CSS](../../shared/fika/component-atlas.css) — approved *component vocabulary* and owner-selected Direction B presentation, with novel treatments flagged for Karol review.
5. Individual app implementation — adapts domain rules and behaviour; may not invent new visual primitives without a documented exception.

Do not mistake an app-local legacy style, a screenshot, a mockup or this proposal for permission to invent another brand palette.

## Governance / decision status

- **Canonical:** FIKA Purple `#4F34C7`, dark purple `#280F8C`, approved secondary palette; Vim Heavy for short display headings; Gilroy for interface copy; semantic colours and focus from tokens; light page surfaces. These are not redesign proposals.
- **Owner selected:** **B / FIKA Tactile**, rather than A minimal or C expressive, as the target visual direction for **new pages and apps**.
- **Karol review pending:** tactile contact-edge effect, elevation intensity, hover motion, exact compact control size, proposed switch/checkbox dimensions, badges and rich chooser treatments. Pending review does **not** permit raw palettes or arbitrary styling.
- **Technical review pending:** shared React component package, app migrations, framework integration, CSS packaging and cross-app E2E tests. The CSS is a reference and is deliberately non-invasive.
- New UI is to **use or faithfully match** approved patterns below, consume semantic tokens, and document any missing review decisions. Do not block a safety or accessibility fix merely because a cosmetic decision is pending; use the conservative Style Guide fallback.
- All existing apps retain their source, business semantics and release boundaries. A touch to one app does not authorise a whole-repo restyle.

## Foundation / global rules

| Area | Canonical or target |
| --- | --- |
| Typeface | Vim Heavy short display headlines; Gilroy Regular/Medium/Semibold/Bold for all working UI. No substituted headline family. |
| Brand | FIKA Purple remains the primary action. Dark purple for strong emphasis. Approved orange as focus. Bright secondary colours are accents, not default body text. |
| Canvas | `--fika-surface-page`, `--fika-surface-card`, `--fika-surface-subtle`; dark readable text, neutral borders. |
| Contrast | WCAG ≥4.5:1 normal text, ≥3:1 large text; test actual foreground/surface pairs. |
| Space | Style Guide rhythm 4/8/12/16/24/32/40/48/64px; only create new aliases after review. |
| Radius | Controls 8px (existing `--radius-sm`); cards existing 14px token; overlay existing 20px token; pill only for chips/badges. |
| Elevation | Flat/soft overlay distinction; reuse `--shadow-sm` and `--shadow-md`. Tactile layering/translation is a **Karol-review proposal**. |
| Type sizes | Guide: button 14/20, body 14/20, helper 13/18, operational table 13/18, title hierarchy as specified. |
| Density | Standard control uses existing `--fika-control-height` = 44px; compact desktop in 32–36px guide range with 36px as *proposed default*; large 48px; mobile touch targets ≈44px+. |
| Focus | Visible orange `:focus-visible`, keyboard operability, focus restoration, no colour-only semantics. |
| Motion | Meaningful, restrained, and reduced/disabled under `prefers-reduced-motion`. |
| Shell | 190px desktop sidebar target, 76px collapsed when supported, ~84px header, 16px mobile gutters, light surfaces. |

## Component catalogue

Each component must document **variant, states, dimensions, keyboard/touch behaviour, content and domain limits**. The associated CSS class examples are in `shared/fika/component-atlas.css`. Classes are reference implementations, not a React API.

### 01. Buttons / actions

- `primary`: single dominant safe action in a local context; purple/white; hover uses `--fika-action-primary-hover`.
- `secondary`: alternative action; white/pale, neutral border and readable text. `tertiary`: low-emphasis text action with explicit hover/focus. `destructive`: danger semantic, consequences described and confirmation if irreversible.
- States: rest, hover, pressed, focus-visible, disabled, loading/busy and completed feedback.
- Standard 44px, compact dense desktop proposed 36px, large 48px, 8px corners; Gilroy Semibold 14px. Icon buttons need accessible names.
- Busy states block duplicate submission and do not imply a durable write until confirmed by the owning service.
- Proposed tactile shadow/contact edge and small hover lift are **Karol review**, not canonical token values.

### 02. Checkbox / radio / switch / segmented controls

- Checkbox: independent multi-select; supports checked, unchecked, mixed/indeterminate and disabled. Label click and Space work.
- Radio: one of a group; use native or fully ARIA-compliant keyboard group semantics.
- Switch: only a setting with immediate effect, not a form choice awaiting Save; expose role/state and clear label.
- Segmented control: compact alternative view choices, visible selected state and logical keyboard operation.
- Approx. 20px checkbox and 44×24 switch track are **proposals**; 44px minimum interactive/touch target remains binding.

### 03. Text, number, currency, search and textarea

- Label is always visible above input; optional helper and error follow control; placeholder is never a label.
- Default 44px high, 8px radius, neutral border and white surface; focus uses semantic ring, invalid uses danger + linked error text.
- Do not erase user-entered values on validation failure. Numbers preserve accessible increment/decrement; custom stepper requires labelled controls.
- Default date format `en-GB`; store date-only/business time with explicit UK timezone semantics per domain.

### 04. Dropdown / combobox / multi-select / picker

- Native labelled `select` first. A searchable combobox is justified when the list is genuinely long or taggable.
- If custom, implement focus, arrow keys, Home/End, typeahead, Escape, accessible selected state and predictable closing. Long option names must remain identifiable.
- Distinguish single choice, multiple choice, chip input, filter control and date/time picker. Do not make these one ambiguous widget.
- App domain owns option loading, authorisation, stale data and mutation behaviour.

### 05. Navigation / tabs / context menus

- Use links for navigation and buttons for actions, with `aria-current` or tab `aria-selected` as applicable.
- Sidebar, breadcrumbs, tab bar, overflow menu, app switcher and mobile navigation share typography/spacing.
- Custom right-click/context menus need keyboard and touch alternatives, real focus order and safe Escape close; never intercept ordinary browser behaviour without accessible necessity.

### 06. Cards / panels / drawers / accordions

- Cards group one operational idea; no oversized empty blocks. Card radius existing 14px and minimal shadows.
- Selectable card exposes real button/link, visible focus, explicit selected state, not a clickable `div`.
- Details/accordion should use semantic native details when practical. Inspector drawer is not a second source of operational truth.

### 07. Tables / lists / pagination / bulk actions

- Semantic headers, readable 13/18 type, numeric alignment, bounded horizontal scroll or responsive labelled rows.
- Normal rows 44–52px, dense desktop 36–44px. Row actions retain adequate targets.
- Show the *exact selected and filtered scope* for bulk actions; confirm destructive or irreversible actions.
- Distinguish loading, empty, unavailable, withdrawn and error; do not invent placeholder work.

### 08. Tags / badges / statuses

- Status: text/icon plus semantic foreground/surface tokens: success, warning/review, danger, info. Colour alone never sufficient.
- Removable tag chips need accessible removal name. Noninteractive labels must not look like clickable buttons.
- Branding accent colours are not generic danger/success text substitutes.

### 09. Dialogs / overlays / popovers

- Standard widths: around 420px confirmation, 560px form, 760px review. Mobile viewport safe margins.
- Title/description, initial focus, trapped Tab, visible cancel/close, safe Escape/backdrop behaviour and focus restoration required.
- Busy writes prevent accidental closure. Never use production `window.alert`, `window.confirm` or `window.prompt`.

### 10. Notices / toasts / empty / loading / progress

- Toasts for brief noncritical success; blocking failures must persist with a safe next action.
- Use live-region announcement appropriately; progress shows stage, count/total and progress when known.
- Never show success before a write confirms or silently substitute stale data.

### 11. Calendars / planners / drag-and-drop

- Day/week/month views, six-week rotations, dish slots, route lanes and time grids compose the shared primitives.
- Selected, draft, published, withdrawn, invalid and locked states must be visually and verbally distinct.
- Drag has keyboard/touch alternative; planner must not make an underlying operational mutation merely through visual preview.
- Domain-owned date policy, permissions, audit and optimistic concurrency remain unchanged.

### 12. Operational patterns

- Dish picker, linked subdish selector, portion stepper, booking card, CPU production card, delivery/collection stop, print-job state, allergen state and driver checklist are **compositions**, not universal business-domain components.
- Keep canonical stable IDs and safety states. Never infer an allergen clearance from a decorative badge.

### 13. Application layouts

- Dashboard, list/detail, calendar + inspector rail, catalogue browser, mobile task view and multistep flows.
- Use approved shell geometry with responsive gutters; preserve one primary CTA per context; no page-width overflow.
- Keep app-specific information architecture in its owning app.

### 14. File upload / review

- Labelled file picker plus drop target, accepted-file guidance, list of chosen files, keyboard access and explicit errors.
- Import preview separates matched, needs-review, skipped, invalid and complete. No fake success.

### 15. Accessibility / internationalisation

- Keyboard first-class; all interactive icons named; logical focus order; Escape/Enter/Space and arrow behaviour where appropriate.
- Respect contrast thresholds, reduced motion, zoom, UK formatting, mobile touch, and text labels for status.
- Accessibility failures are defects, not optional aesthetic changes.

## Applying this to new pages/apps

1. Read the brand guidelines, `docs/STYLE-GUIDE.md`, `shared/fika/tokens.css`, **this atlas**, reference CSS and affected app AGENTS.
2. Identify the required component family and reuse its supported semantic variant. If no approved component exists, make a documented proposal with a named reviewer rather than inventing a local colour/shadow/font.
3. Consume canonical tokens. Keep domain ownership, contracts, auth, accessibility and app deployment boundaries intact.
4. Validate at 390px, 768px and desktop widths (or real target widths), keyboard focus, pointer/touch, loading/error/empty, reduced motion and contrast as relevant.
5. Add targeted interaction tests where production UI is modified. New components require implementation review, app-specific integration and governed PR/CI; CSS spec alone does not mean production components have been migrated.
6. Return **Style Guide compliance: PASS** or **DEVIATION** with documented evidence. List outstanding Karol decisions.

## Source and previews

The owner has reviewed three-way A/B/C Button and Selection sheets and selected **B** for all subsequent families. The complete offline 16-section Design Lab is supplied separately; it uses **no** live customer data and includes no proprietary font binaries. This reference CSS is class-scoped and imports *no* global resets. Reuse it as a specification; do not globally inject it into existing apps without a governed adoption slice.

## Review register

| ID | Decision | Status |
|---|---|---|
| BR-01 | Exact brand palette and headline/body font pairing | **Canonical** |
| DS-01 | Direction B for new UI | **Owner selected** |
| DS-02 | Button tactile edge, hover elevation / movement | **Karol review** |
| DS-03 | Compact/large component dimensions and density | **Karol review where not already explicit in Guide** |
| DS-04 | 20px checkbox, 44×24 switch, custom combobox | **Karol/interaction review** |
| DS-05 | One shared React package vs app adapters | **Engineering decision; not implemented** |
| DS-06 | Existing app component migrations | **Separately scoped changes only** |
