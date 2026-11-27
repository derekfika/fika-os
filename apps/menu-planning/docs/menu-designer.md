# Menu Designer

Menu Designer maintains reusable category and row layouts for supplementary menus. It reuses the versioned Menu Structure Library; applying a saved layout copies its category and row identities into the new menu instance, so future library edits do not change existing plans or publications.

The layout editor contains no service date, site allocation, dish, portion, PAX or publication state. Those operational details remain on each Week Planner menu instance.

## Source locations

- `app/menu-designer/page.tsx` provides the saved-layout list, editing lifecycle, unsaved-change handling and API calls.
- `app/menu-structure-editor.tsx` edits categories and named rows, with drag ordering and arrow-button alternatives.
- `lib/menu-structure-library.ts` owns the shared structure types, validation and copy behavior.
- `app/api/menu-structure-library/route.ts` owns authenticated structure listing and versioned create/edit/duplicate/archive actions.
- `app/week-planner.tsx` selects a saved layout when creating a supplementary service and keeps service configuration separate from layout editing.
- `app/planning-context-nav.tsx` handles global weekly menu selection and carries recurring supplementary menu identity to matching weeks when available.

Editing or archiving a saved layout does not mutate existing menu snapshots. A new supplementary menu receives an independent copy of the selected layout.
