# Hospitality Menu Studio storyboard review

Source-level comparison with the owner's 12-screen board for #586. The issue is authoritative where the board differs. This implementation inventory records source inspection. Visual acceptance and authenticated UAT remain outstanding.

| Board screen | Implemented in the draft interface | Remaining gap or distinction |
| --- | --- | --- |
| 1. Home | Menu, collection and dish entry points. Loaded draft activity and local recovery copies. Published status explicitly unavailable. | Published/current/next status and complete activity depend on publication and history authorities. |
| 2. Create menu | Choose seasonal or collection and optionally copy loaded menu content. Edit dates and rotation anchor in the new draft. | The interface uses a direct form. The board shows a three-step wizard. |
| 3. Seasonal overview | Editable name, dates and anchor, section list, static/rotation mode and catalogue mapping state. Preview and review entry points. | Publication progress and confirmed published status are not available. |
| 4. Section editor | One full-width section, search and category/temperature filters, dish add/remove, keyboard-accessible move controls and catalogue mapping. | Selected rows are grouped by classification with advisory targets for recognised standard section names; underlying vegetarian and vegan classifications remain distinct. |
| 5. Rotation editor | Six week buttons, independent selections and copy from another week. | No multi-week grid, which the issue defers to Phase 2. |
| 6. Dish collection | Search, category and temperature filters, version and explicitly unavailable allergen status. | Usage lists and verified safety evidence are not connected. |
| 7. Dish editor | Name, classification, temperature, separate customer and kitchen descriptions, autosave state and local recovery. | Food-safety signing stays in the existing process. Full conflict reconciliation remains to be designed. |
| 8. Assortment | Optional fixed contents, quantities, unit, expected total and draft count feedback. | Publication validation remains server-owned. Incomplete drafts remain saveable. |
| 9. Customer preview | Event-date draft preview displays customer copy only. Optional site check uses the Hub catalogue when available. | Draft and parent-offering visibility are not final customer availability. Full booking acceptance stays in Hub. |
| 10. Review and publish | Scope, date, readiness issues, safety and impact states, and explicit gated confirmation. | The screen displays the selected scope. Saved draft structure can be compared in History. Published-revision comparison remains outstanding, and publication stays closed until the required authorities are available. |
| 11. Booking impact | Displays returned bookings or states that impact is unavailable, and explains that existing bookings are unchanged. | Authoritative booking-impact integration is not yet available. |
| 12. Activation and kitchen | Separate activation request. Draft kitchen description and validated box/component arithmetic. | Activation is fail-closed without authorities. Verified CPU packet and printed run-sheet previews remain outstanding. |

The board contains illustrative foods, dates and verification badges. None is treated as production data or safety evidence. The assortment count follows the issue's fixed-assortment rule. The board shows an ingredient-style example.

Local browser inspection stopped with: “Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy. Stop your work and send a final message noting why Computer Use ended.” No screenshot, keyboard, responsive or visual-parity result was observed. Repeat those checks at desktop, tablet and narrow widths in an authorised local or staging browser before acceptance.

Completion sprint: source implementation and automated checks do not constitute visual acceptance. Desktop, tablet, narrow viewport and keyboard browser checks remain blocked after Computer Use could not determine the browser URL with sufficient confidence.

The dish editor can check or explicitly request review of a saved exact dish version when the checker service is available. Unsupported responses remain unavailable, and any optional local checker link is validated against the returned subject and exact path. Checker integration is delivered separately by #596; it remains unavailable until that provider is integrated and configured. Browser acceptance remains outstanding.
