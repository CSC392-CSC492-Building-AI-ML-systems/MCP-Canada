# Housing workspace

The housing page implements the shared layout from Figma 02A, 02B1, 02B2 and
02C. The live Mapbox basemap and imported Toronto Census data replace the design's
illustrative UTM imagery and sample measurements.

- `/housing/`: collapsed 64 px saved-places rail, flexible map and 380 px details panel.
- `/housing/?list=saved`: expanded 320 px saved-places sidebar (02B1).
- `/housing/?list=recommended`: recommendations sidebar (02B2).
- `/housing/?view=across-time`: historical details panel (02C).

The map keeps the selected-place row and 120 px timeline dock underneath it.
The left and right panels scroll independently and retain their footer actions.
At smaller widths, panels stack and remain accessible without squeezing the map.

Saved places persist under the existing `mcp-canada-saved-housing` localStorage key,
with a limit of five. Select a card to commit a selection; hovering or focusing it
previews that location. Leaving the list restores the committed selection.
The compare action opens a local comparison dialog using one shared Census year.
Different boundary sets cannot be compared in that dialog.

Recommendation ranking is not implemented. `ExplorationWorkspace` accepts an
optional `recommendedPlaces: ExplorerPlace[]` prop for the recommendation feature
to provide up to five results (id, name, boundary, year, optional summary and score).
The sidebar shows an empty state until real recommendations are supplied. It does
not fill the list with the illustrative Figma neighbourhoods or fabricated scores.

Across-time comparison keeps the same geography and boundary set and exposes only
loaded Census periods. Current 158 has 2021; Historical 140 has 2001, 2006, 2011,
2016. Earlier average rent and later median shelter costs have different definitions;
no change percentage is inferred. All amounts remain nominal. The selected year
updates Census data, not the present-day basemap. Land use, historical imagery and
the AI teacher remain unavailable until their data/services are connected.
