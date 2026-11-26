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

## Census years and boundaries

Both boundary sets show 2001, 2006, 2011, 2016 and 2021 on the timeline. The City
published 2001–2016 on its 140 earlier neighbourhoods and 2021 on the current 158.
Every 2021 neighbourhood lies inside one earlier neighbourhood: 124 are unchanged and
16 were split into 34 parts. See the README section "Comparing 2021 with earlier
Census years" for how the links are built.

- **Historical 140:** the full 2001–2021 series for every neighbourhood. For a
  neighbourhood split in 2021, the backend combines the 2021 values of its parts:
  counts are added and averages are weighted by the households they describe.
  Medians are not combined. Combined values are marked with an asterisk and a note.
- **Current 158:** earlier years appear only for the 124 unchanged neighbourhoods,
  from the identical earlier area. A split neighbourhood shows "unavailable" before
  2021 and names the larger earlier neighbourhood it belonged to.

Across-time comparison (`?view=across-time`) keeps one neighbourhood boundary for
every period. It shows average renter shelter cost, average household income and
population for up to three chosen years. A "What changed" summary gives the dollar
or count change and the percent change between the earliest and latest chosen
years. Changes of 15% or more are marked "Major change". The summary reports
measured change only, not causes. A missing value is shown as a dash and is never
treated as zero.

Rent and income use averages in every year so that all periods share one
definition; renter shelter cost was called "gross rent" in 2001 and 2006. The 2016
neighbourhood profile does not publish renter shelter cost. All amounts are nominal
(not adjusted for inflation). The selected year changes the Census data, not the
present-day basemap.

## Map layers

The chips above the map turn layers on and off:

| Chip | What it does | Remembered |
| --- | --- | --- |
| Boundaries | Outlines of every neighbourhood. The selected neighbourhood stays highlighted and clickable when outlines are off. | Yes, `mcp-canada-show-boundaries` |
| Population | Shades each neighbourhood by population for the selected year, with a legend. Bands are the same for every year: under 10k, 10k–15k, 15k–20k, 20k–30k, 30k and over. Grey means no data. On Current 158 before 2021, split neighbourhoods are grey rather than given their larger area's population. 2021 is a 25% sample total, not a full count. | Yes, `mcp-canada-show-population` |
| 3D buildings | Mapbox 3D buildings and landmarks. | No |
| Transit | Mapbox transit labels. | No |
| Land use, Historic imagery | Shown but disabled: no data is loaded yet. | — |

The remembered choices are stored in this browser's localStorage. When storage is
blocked, a choice lasts for the visit. Both are on by default. Hovering a
neighbourhood shows its name and, when shading is on, its population.
