# Housing exploration frontend

`/housing/` now hosts the shared exploration layout and independently scrolling
380px housing/details panel. `/housing/data/` retains the previous data browser.

This change is frontend only: no new backend endpoints, database writes, models,
migrations, imports, or backend scoring are added. `data.ts` reads the existing
`/api/catalog/` and `/api/observations/` routes. Exact reviewed Census indicator
IDs are used. If more than one matching release exists, the value is unavailable
until a release is explicitly selected; no arbitrary release is chosen.

## Connect the map and timeline

`ExplorationWorkspace` owns `ExplorationSelection`:

```ts
type ExplorationSelection = {
  boundarySetId: string;
  geographyId: string;
  year: number;
};
```

A teammate can supply `renderMap(selection, onSelectionChange)` from a client
wrapper. The map can receive the current selection and send pin/area selections
back through that callback. Invalid boundary/year/geography combinations are
rejected. `CensusTimeline` is controlled through `years`, `year` and
`onYearChange`, so it can be moved into the final shared page without a second
independent year state. The blank map slot deliberately supplies no map renderer,
API key, routing, or guessed location data.

`NeighbourhoodDetailsPanel` is a reusable controlled component. It receives the
profile, personal budget inputs, input callbacks and optional action callbacks.
Income and budget remain in page memory; they are not sent to the API or stored.
Saved comparison selections contain geography IDs, labels, boundary sets and
Census years only, up to five entries in local storage (or session fallback).
The list is a handoff for the comparison feature; it does not implement comparison
scores or a full comparison view. The AI action is disabled until a callback is
connected. Shared score calculation, commute metrics, nearby distances, safety,
and lifestyle scoring are deferred and displayed as unavailable.

## Housing display rules

- 2021 uses the 158 neighbourhood boundary set. 2001/2006/2011/2016 use 140.
- Changing the boundary set starts a new explicit selection; it is not a crosswalk.
- Each value displays its source/reference year; income is commonly from the
  calendar year before the Census. No latest-year data fills earlier periods.
- Shelter costs include applicable utilities and are not bedroom-specific asking
  rent. Monetary values remain nominal; inflation adjustment is not implemented.
- The personal budget check uses entered annual before-tax income divided by 12,
  and the 30% guideline. It is distinct from the published housing-burden rate and
  is not an overall match score. Equality counts as within budget.
- Unavailable costs, income, travel and scores remain unavailable, not zero.
- The history display retains source definitions; it does not compute changes
  across average/median measures or different boundary versions.

## Checks

Use the repository's supported Node version (Node 24 recommended):

```sh
cd frontend
npm run typecheck
npm run lint
node --test tests/*.test.mjs
npm run build
```

Browser checks covered 1504×1024 desktop and 390×844 mobile, a 380px desktop panel,
no horizontal overflow, actual 2021 and 2011 Census values, missing 2016 housing
values, income/budget calculation, saved-place addition/removal, and year changes.
