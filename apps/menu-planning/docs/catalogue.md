# Menu Planning catalogue

The catalogue workspace is the Menu Planning landing surface. It is a read/write view assembled from the existing governed stores:

- canonical `MenuItem` records from the menu planning repository;
- saved chef sandwich builds, retained as reusable production evidence; and
- Brian recipe-import candidates, explicitly labelled as source evidence.

The `/api/catalogue` route is a typed read adapter for these sources. It supports search and category, usage and lifecycle filters without copying or silently promoting source records. A candidate must still pass the existing review and publication commands before it becomes a canonical menu item.

Hospitality Menu Offerings and prices remain a separate governed concern. The catalogue may link a reusable item to a hospitality workflow, but it does not create or mutate an offering as a side effect of catalogue browsing.

Weekly plans reference stable canonical item IDs. Saved sandwiches are available to the production/allergen workflow and source candidates remain outside a week plan until deliberately adopted.
