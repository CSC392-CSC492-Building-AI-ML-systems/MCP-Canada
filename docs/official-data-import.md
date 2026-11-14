# Official data import

The local SQLite database is populated. Raw downloads live in ignored `data/raw/`;
normalized bundles live in ignored `data/normalized/`. These are local data, not
Git-tracked seed fixtures. `data/official-sources.json` records the exact public
URLs, retrieval timestamps and SHA-256 digests. No API key is required.

## Census-only local setup

To populate the map and housing timeline without downloading CMHC or amenity feeds,
run these commands from the repository root:

```sh
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/scripts/prepare_official_data.py --census-only --download --output data/normalized/census.json
backend/.venv/bin/python backend/manage.py import_dataset data/normalized/census.json --dry-run
backend/.venv/bin/python backend/manage.py import_dataset data/normalized/census.json
backend/.venv/bin/python backend/manage.py data_inventory
```

The seven pinned files provide 298 versioned neighbourhood polygons, 184 indicator
definitions, 26,696 measurement records and 9,206 staged source rows. Refresh
`/housing/` after importing. The timeline shows 2021 for Current 158 boundaries;
choose Historical 140 in its boundary selector to explore 2001, 2006, 2011 and
2016. Changing the year updates the selected Census data, not the present-day
Mapbox imagery. Missing and suppressed source cells remain unavailable.

## One-command setup

For a full local setup, including the grocery, crime and green-space data used by the
comparison page, run `backend/scripts/setup_official_data.py` as described in
[local data setup](local-data-setup.md). It wraps the manual steps below with checksum checks,
a dry run on a temporary database copy, a backup, and a confirmation before any repair.

## Reproduce from the saved files

After installing backend requirements and activating your own virtual environment:

```sh
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/scripts/prepare_official_data.py
backend/.venv/bin/python backend/manage.py import_dataset data/normalized/official.json --dry-run
backend/.venv/bin/python backend/manage.py import_dataset data/normalized/official.json
backend/.venv/bin/python backend/manage.py data_inventory
```

To fetch a missing raw snapshot, add `--download` to the preparation command. This
only accepts bytes matching the pinned digest. Live endpoints, especially CPI,
GTFS and OpenStreetMap, change: if a digest differs, retain the old snapshot and
review a new manifest/release rather than changing its checksum blindly. The
normalizer derives release IDs from file checksums, so a new reviewed snapshot is
a distinct release. Consumers must explicitly choose a release to avoid double
counting repeated/overlapping periods.

The manifest contains public source URLs only. Copying this code alone does not
copy the local database or raw data. Downloading the same bytes later may not be
possible from live APIs; preserve the original snapshots for exact reproduction.
Check source terms before redistributing any raw download. Toronto catalogue
metadata returned "License not specified" for the queried packages; this is stored
explicitly rather than assigning an unverified licence. OSM uses ODbL attribution;
CMHC workbooks carry CMHC copyright and their own terms. The grocery, crime and
green-space snapshots were reviewed on 2026-11-14 (ODbL 1.0, Open Government
Licence – Ontario as published by the Toronto Police Service, and Open Government
Licence – Toronto). Their attribution and conditions are in `data/official-sources.json`
and [local data setup](local-data-setup.md#licence-review-checked-2026-11-14).

## What is stored

**Reviewed measurements** are in `Observation`, with exact source geography,
definition, value/status, Census year, reference year, period and source locator.
The source-specific normalizer includes checked row mappings; it does not turn
every numeric-looking source cell into a comparable statistic. Census mappings
are versioned by Census year/row, not silently harmonized across years. The 2021
population age table is a 25% sample table; it is not labelled a 100% population
count. CPI is national, all-items, monthly, not seasonally adjusted, 2002=100.

**Full source table rows** are in `SourceTableRow`. This preserves every row and
cell of the five Census profiles, all CMHC workbook sheets (including headers,
footnotes, reliability markers, historical tables, and subtotals), library
attributes, park polygons, school attributes, and OSM records. These rows are
staging records, not approved comparison indicators. `locator` identifies the
original CSV row or sheet/row; `cells` and `metadata` retain the original values
and context. Do not run affordability calculations directly against staged rows.
Census staging cells use explicit versioned geography IDs; city aggregates are
labelled separately as `source_city_of_toronto`. Original CSV/XLSX files are also
preserved, so row formatting and original documents can be consulted.

**Places** contain school locations, physical library branches, TTC GTFS stop
records and OSM grocery-related objects. Snapshot retrieval dates do not establish
opening dates, operating status or historical availability. Grocery coverage is
the explicit Toronto-area bounding box and includes adjacent municipalities;
these are OSM objects, not verified unique businesses. OSM way/relation coordinates
are returned bounding-box centres, not entrances. No historical amenity scores or
neighbourhood counts are inferred. TTC records retain `location_type` so stations,
platforms and entrances must be distinguished before counting service stops.

Park/green-space polygons remain polygons in source rows, without invented
entrances or centroids. From the current City Green Spaces snapshot, the normalizer
derives two indicators for every 140 and 158 neighbourhood: `green-parks-within-1km`
(distinct parks of class Park or Open Green Space within 1 km of the boundary) and
`green-space-share` (the union of reviewed green-space classes as a percentage of the
area; golf courses, building grounds and road fragments are excluded). Any unreviewed
`AREA_CLASS` stops the build. These are current-snapshot measures, not historical values.

**Places within 1 km** (`places-within-1km-library`, `-school`, `-grocery`, `-transit_stop`)
count each place list inside every 140 and 158 neighbourhood or within 1 km of its boundary.
Each is stored under its own place list's release. Groceries are OSM supermarkets and
greengrocers, excluding convenience stores; transit counts every GTFS stop record.
`area-within-1km-km2` (under each boundary release) is the size of that area, so the compare
page can rank place densities rather than raw counts, which favour large neighbourhoods.

**Toronto Police crime rates** (`tps-crime-*`) hold published counts and rates per
100,000 for nine offence types, 2014–2025, on the 158 neighbourhoods. Population
(the TPS estimate, not Census) is published only for 2025. GTFS route/schedule files remain available in the raw feed
ZIP, but routing, travel-time calculation and schedule queries are not implemented.

## Known gaps and comparison limits

- Some 2001, 2006 and 2016 neighbourhood income/cost cells are blank. They remain
  unavailable; city-wide values are never substituted. The 2016 CSV also contains
  apparent row misalignment/interleaving. Those raw rows are preserved and are not
  assumed to form valid definitions. In particular, the suspicious 2016 average
  after-tax household-income row is not promoted. This is a source-quality flag,
  not a claim that the City has confirmed an error.
- 2011 income and housing reflect NHS-era data. Census-year definitions and sample
  coverage must be reviewed before comparing vintages. Income generally references
  the previous calendar year, while shelter costs reference the Census year.
  Housing-burden ratios combine those different reference periods.
- Toronto 140 and 158 neighbourhood sets are kept separate. Historical source
  names map uniquely to the official 140 boundary names after punctuation/case
  normalization. The 2021 158 codes/names were checked against the 158 boundaries.
  No 140-to-158 crosswalk, areal interpolation or boundary allocation is supplied.
- CMHC 2019–2025 editions contain zone/CMA measures for 2018–2025. Each edition's
  zone set is stored separately, with 31 zone labels per edition. Those are CMHC
  zones, not Toronto neighbourhoods. Subtotals and other geographic levels remain
  in staging unless explicitly mapped. Estimates and reliability letters are kept
  together. Suppressed values are null, not zero. Raw historical CMHC tables extend
  beyond the normalized 2018–2025 series; they need separate checked adapters.
- Current amenity feeds and OSM coverage are incomplete representations of services.
  Schools, library branches, green spaces and groceries do not constitute a full
  amenity census. Restaurants, healthcare and other categories are not imported.
- Inflation adjustment is not automatically applied. National CPI is a contextual
  series, not neighbourhood-specific inflation. Monetary observations stay nominal.
- All application comparison queries must select an explicit release and definition.
  `comparable_values` stays conservative about differing definitions and boundaries.

## Source entry points

- [Toronto neighbourhood profiles](https://open.toronto.ca/dataset/neighbourhood-profiles/)
- [Toronto neighbourhood boundaries](https://open.toronto.ca/dataset/neighbourhoods/)
- [CMHC rental market tables](https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables/rental-market/rental-market-report-data-tables)
- [Bank of Canada CPI](https://www.bankofcanada.ca/stats/cpi)
- [Merged TTC GTFS](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/)
- [School locations](https://open.toronto.ca/dataset/school-locations-all-types/)
- [Library branches](https://open.toronto.ca/dataset/library-branch-general-information/)
- [Parks](https://open.toronto.ca/dataset/parks/)
- [Green Spaces](https://open.toronto.ca/dataset/green-spaces/)
- [Toronto Police neighbourhood crime rates](https://data.torontopolice.on.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data/about)
- [OpenStreetMap attribution and licence](https://www.openstreetmap.org/copyright)
