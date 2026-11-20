# Hospitality Menu Studio storyboard review

The owner’s original **FIKA OS Hospitality Menu Studio UI Board.png** was available and used directly. Issue [#586](https://github.com/derekfika/fika-os/issues/586) governs behaviour and safety states. Visual approval is pending.

The hosted staging build reported source `dbaa699f59337709ab084872fc05feac14aa2d0b`. The before captures use its identical Studio, shared UI and shared runtime source on loopback. The after captures use the redesign with the same fictional draft dataset in an isolated Firestore emulator. Both sets were captured in the browser at 1440 × 900 and 1024 × 768. The owner comparison gallery includes the matching board tile, desktop and tablet captures, and links to the baseline.

## Visual discrepancies and corrections

| Board screen | Observed baseline | Redesigned view and remaining differences |
| --- | --- | --- |
| 1. Home / My menus | White header, text-only navigation, warm canvas, three equal workflow cards and a separate large activity panel. | Purple product header, icon sidebar, light canvas, two seasonal cards and three compact summaries. Current publication is marked unavailable. |
| 2. Create menu | An inline card with two buttons led directly to a draft. | Three-step Type, Details and Confirm wizard with two selectable cards, optional copy and date/anchor fields. Confirm starts autosave. |
| 3. Seasonal overview | Name and date form filled the initial viewport and pushed sections down on tablet. | Draft chip, dates and actions above aligned rows with mode and choice counts. Editing dates and mapping details stays available. |
| 4. Section editor | Setup, catalogue mapping and removal preceded the dish choices. Category and temperature controls were below the rows. | Full-width choices table, category and temperature chips, grouped rows, save status and visible add action. Setup moves into a disclosure. Move controls work by keyboard and touch. |
| 5. Six-week rotation | Week labels and copy controls shared a large form with section setup. | W1–W6 segmented control, a rotation summary and compact copy controls. Replacing a populated week requires confirmation. |
| 6. Dish collection | Text-only list with temperature, version and allergen availability collapsed into a trailing line. | Search and filters above aligned dish, category, temperature, allergen, version and loaded-menu usage columns. Allergen evidence remains unavailable. |
| 7. Dish editor | Classification and descriptions flowed as horizontal form rows with assortment appended underneath. | Two-column identity and description form with separate customer and kitchen copy, character counts, autosave and distinct assortment and kitchen actions. Explicit save in the mockup is represented by acknowledged autosave. |
| 8. Assortment builder | Configuration and repeated component fields occupied the bottom of the dish editor. | Dedicated split view with box configuration, a per-box component table and a matching-total or attention notice. Incomplete drafts remain saveable. |
| 9. Customer preview | The date rendered all sections in one long authoring card. | Framed customer-facing copy with section navigation, category chips and Web/Mobile views. Date and site controls sit outside the preview. Hub remains the source of eligibility. |
| 10. Review and publication | A tall single form placed status text, issues and confirmation in one flow. | Status rows, immediate/scheduled controls and a review summary. The published comparison and allergen evidence show their unavailable states, with confirmation disabled. |
| 11. Booking impact | Unavailable impact was a paragraph inside the publication form. | Dedicated advisory panel with a booking table when authority exists. An unavailable result explicitly means the affected count is unknown. |
| 12. Collection and kitchen | Activation was embedded in history. Draft kitchen arithmetic was a text list. | Dedicated collection activation and linked kitchen preview. The draft preview shows per-box and total quantities. Activation and verified CPU output remain unavailable. |
| Additional. Versions and history | Version select and restore controls were visible without a revision table or comparison. | Chronological versions, current version status, structural comparison using the existing endpoint and restore-as-new-draft. Same-tab reopening uses the restored version. |

## Browser and regression evidence

- All 12 board panels, both screen 12 views and the supplemental History view captured at both sizes.
- Checked Home, Overview, Section, Preview, Dish Collection, Assortment and Review at 390 × 844 without page-width overflow.
- Browser checks covered skip-link focus, wizard focus, keyboard dish-picker focus, category filtering and active-week contrast of 7.93:1.
- Fictional browser checks covered creation and autosave, re-opening and editing, independent week selection and copying, structural comparison, restore followed by an immediate same-tab save, and rejection and local recovery of a concurrent stale edit.
- Incomplete assortment autosave, corrected totals, 4 × 24 = 96 in the kitchen draft, and exclusion of kitchen copy from customer preview were exercised. Publish and Activate stayed disabled.
- The storyboard’s sample data and status badges identify its intended presentation. The fixtures are explicitly labelled and carry no signed, published, activation, commercial or operational evidence.

## Style Guide compliance

PASS for the exercised scope. The interface uses Gilroy, shared FIKA tokens, canonical 190 px sidebar and 84 px header dimensions, light working surfaces and compact, scrollable tables. The reference is proportionally denser. Touch layouts retain larger controls and move secondary actions below the fold where necessary.

The redesign has been verified in a local browser. Owner visual approval and a governed staging rollout of the approved source are pending.
