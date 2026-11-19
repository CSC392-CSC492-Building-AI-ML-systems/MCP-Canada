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

The map keeps its overlays to a minimum. Top left are a **Layers** button and the search box.
Bottom left is one collapsible **legend** that covers every active layer. The neighbourhood's
name is in the details panel and the selected-place bar, not repeated over the map. The
Layers button opens grouped checkboxes ("Colour the map by", "Nearby places", "Map") and
shows how many data layers are on; basemap settings are not counted. It closes on Escape,
which returns focus to the button, or on a click outside. The legend's source lines are
hidden on short maps but stay in each section's tooltip.

| Layer | What it does | Remembered |
| --- | --- | --- |
| Neighbourhood outlines | Outlines of every neighbourhood. The selected neighbourhood stays highlighted and clickable when outlines are off. | Yes, `mcp-canada-show-boundaries` |
| Population | Shades each neighbourhood by population for the selected year, with a legend. Bands are the same for every year: under 10k, 10k–15k, 15k–20k, 20k–30k, 30k and over. Grey means no data. On Current 158 before 2021, split neighbourhoods are grey rather than given their larger area's population. 2021 is a 25% sample total, not a full count. | Yes, `mcp-canada-show-population` |
| 3D buildings | Mapbox 3D buildings and landmarks. | No |
| Transit labels | Mapbox transit labels. | No |
| Nearby: Schools, Groceries, Transit stops, Libraries | Points for that kind of place in and up to 1 km around the selected neighbourhood. Hovering a point shows its walk. The details panel's "Everyday needs" lists the count within 1 km, the nearest place and, under "Closest walks for each", the three quickest walks of each kind. Off by default. | Yes, `mcp-canada-amenity-layers` |
| Land use | Colours the selected neighbourhood by City zoning (By-law 569-2013), with a legend giving each category's share of its area. Zoning is what land is zoned for, not what is built, and it is present day. Turning it on turns Population off (they colour the same areas), and the other way round. Off by default. | Yes, `mcp-canada-show-land-use` |
| Nearby: Parks | Outlines parks near the selected neighbourhood. Distances are to each park's edge. | Yes, `mcp-canada-amenity-layers` |
| Historic imagery | Shown but disabled: no data is loaded yet. | — |

The remembered choices are stored in this browser's localStorage. When storage is
blocked, a choice lasts for the visit. Boundaries and Population are on by default.
Hovering shows one label for whatever is on top under the cursor: an amenity point
(name and distance), otherwise a park (name and distance to its edge), otherwise the
neighbourhood (name and, when shading is on, its population). Labels never stack.

### Nearby places

Amenity locations come from `/api/places/` and are a present-day snapshot, not
historical. The card says so and shows the snapshot date and source. Walks start
from the searched address when it lies inside the selected neighbourhood, and
otherwise from the neighbourhood's centre.

**Walking times follow streets and paths.** For each kind of place, the four closest
in a straight line are sent to the Mapbox Matrix API with its walking profile
(`frontend/src/lib/walking.ts`). That is one request for up to 24 places, using the
same API and token as the commute times in PR #29. The card and panel show the
quickest walk, with its street distance. It is not always the straight-line nearest:
in High Park-Swansea the closest school is 620 m away in a straight line but a 1.0 km,
12-minute walk. Routes to a park end at the closest point on its edge, and a starting
point inside a park needs no walk. Routes are remembered for the visit.

- If there is no Mapbox token, or Mapbox fails, the times fall back to a straight-line
  estimate. The estimate assumes 4.8 km/h on a route about 1.3 times the straight line,
  and is marked with "~" and "estimate".
- "Within 1 km" is still a straight-line count from the starting point, since routing
  every place would take hundreds of requests. The labels say so.
- Groceries count only supermarkets and greengrocers, as the import does: convenience
  stores are excluded. Names stored in capitals are shown in title case.

The map loads all four kinds for the selected neighbourhood, whichever layers are on,
and shares one set of summaries with the details panel through
`frontend/src/lib/nearbyStore.ts`. The panel's "Everyday needs" table therefore shows
the same count, nearest place and walk as the map card. It ignores numbers calculated
for a different neighbourhood, and it waits for the map rather than showing zeros.

Parks are areas, so the import deliberately stores no invented centre points for them.
`GET /api/parks/nearby/?longitude=&latitude=&bbox=` (`backend/api/parks.py`) measures
straight-line distance to each park's nearest edge, and 0 when the point is inside a
park. It also returns that edge point, which is where a walking route to the park ends. It uses the City Green Spaces polygons already staged by the import, with the
same park classes (Park, Open Green Space) and the same grouping of pieces into one
park by `AREA_ID`. Its "within 1 km" is measured from the origin point. The
comparison table's "Parks within 1 km" instead counts parks within 1 km of the
neighbourhood boundary, so the two numbers can differ. The Parks layer outlines the
measured parks on the map.

### Land use (zoning)

The City publishes no land-use map in its open data. The closest official layer is the
Zoning By-law 569-2013 "Zoning Area" file: 11,719 zones with amendments to June 18,
2023. The file is added to `data/official-sources.json` as `zoning-areas.geojson` and
staged by the import. `GET /api/land-use/?geography_id=` (`backend/api/land_use.py`)
clips the zones to one neighbourhood and returns each category's share of its area.

- **Permitted, not actual.** Zoning says what land may be used for, not what is on it
  today, and it is not historical. The legend says both.
- **Large City parks are not in the zoning file.** For example, 26.5% of High
  Park-Swansea is High Park, which has no zone. Unzoned land that is a City park in the
  Green Spaces snapshot is shown as "City park, not in the zoning file", from that
  source.
- **"No zone in the file"** is the remaining unzoned land: mostly road allowances, rail
  and water, plus lands still under an older by-law. It is never assigned a category.
- **No release mirror yet.** If the City republishes the file with different bytes, the
  pinned SHA-256 will no longer match the download. Upload the pinned snapshot to the
  project data release and add it as `mirror`, as the other sources have.

A list that was never imported shows "Not loaded in this database", never zero.
`/api/places/` returns `category_loaded` so the map can tell that apart from an area
with none nearby. Groceries come from OpenStreetMap and transit stops from the TTC
schedule. Both need a recent run of `backend/scripts/setup_official_data.py`.

`distanceScore()` in `frontend/src/lib/amenities.ts` turns a distance into a 0–100
score: 100 at the door, 0 at 1 km or more, and a closer place never scores lower.
It is ready for the match score but is not wired into it yet.
