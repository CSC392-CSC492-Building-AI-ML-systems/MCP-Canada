# Database MVP

Uses Django ORM + SQLite to match the existing backend without a new service or
credentials. GeoJSON polygons are stored as JSON; spatial indexing and point-in-polygon
queries are deferred to a future PostgreSQL/PostGIS migration. No personal budgets
or addresses are persisted. Official snapshots are loaded locally using the pipeline in official-data-import.md; no values are fabricated.

## Setup

From repository root after installing backend/requirements.txt:

```sh
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/manage.py check
backend/.venv/bin/python backend/manage.py test api
```

Django reads shell variables, not .env files. Optionally export DJANGO_DB_PATH to
an absolute SQLite file path. Back up that file while writers are stopped. Keep
local files out of Git. Production should choose managed PostgreSQL and adapt the
Django DATABASES setting using environment variables before multi-user deployment.

## Schema

- SourceRelease: immutable artifact/release ID, publisher, URL, licence, retrieval
  timestamp, original file SHA-256, geographic coverage and caveats.
- GeographySet: source-defined kind/version and optional expected count. Use separate
  IDs for Toronto historical 140 and current 158 boundaries, and distinct sets for
  municipality, CMA, CMHC zones, province and national coverage.
- Geography: source code unique within a set, name and optional WGS84 GeoJSON
  Polygon/MultiPolygon. IDs must include the set; matching names/codes do not imply
  matching boundaries. expected_count=140/158 validates complete boundary batches.
- Indicator: a versioned definition, unit, universe, statistic and dimensions.
  Define separate IDs for median/average, before/after-tax household income,
  renter monthly shelter cost, housing burden percentage and its denominator,
  population and demographic subgroups. CMHC bedrooms, rental universe and
  measure (rent/vacancy), and CPI basket/base/price basis belong in dimensions.
- Observation: exact geography + indicator + release + reference year + period,
  optional Census year, decimal value, availability status and source cell locator.
  Missing/suppressed/not-applicable values must be null; observed zero is retained.
- Place: release-specific amenity or transit stop ID, category, coordinates,
  snapshot date and source properties. GTFS stop IDs go in source_record_id;
  routes/feed details may go in properties. Routes, schedules and routing are
  deferred; stops alone do not establish transit service quality.

## Import pipeline

Download source artifacts into ignored data/raw/, inspect their dictionaries and
licences, and calculate SHA-256 (`shasum -a 256 path/to/file`). Normalize each source
into a UTF-8 JSON bundle using the field names below. Preserve original files and
record table/sheet/row/column identifiers. This MVP deliberately requires reviewed
normalization rather than guessing mappings for incompatible source formats.

Top-level arrays are sources, geography_sets, geographies, indicators,
observations and places, processed in that order. Any subset is allowed. Unknown
sections/fields and conflicts fail. Foreign keys use `<field>_id`; scalar primary
keys use `id`. Dates use ISO dates and timestamps include time zones.

Required fields (apart from generated numeric IDs):

```text
sources: id, publisher, title, url, licence, retrieved_at, sha256, coverage
geography_sets: id, kind, version, source_id [expected_count]
geographies: id, geography_set_id, code, name [geometry]
indicators: id, label, unit, definition, universe, statistic [dimensions]
observations: source_id, geography_id, indicator_id, reference_year, period,
              status, source_locator [census_year, value, notes]
places: source_id, source_record_id, category, name, latitude, longitude, valid_on
        [properties]
```

Decimal values should be JSON strings to preserve precision. Explicitly use null
for unavailable values; do not coerce suppression symbols to zero. Indicator
metadata and release metadata are the seed data: load only verified definitions
from the selected source dictionary. There is no fake production seed dataset.

```sh
backend/.venv/bin/python backend/manage.py import_dataset data/normalized.json --dry-run
backend/.venv/bin/python backend/manage.py import_dataset data/normalized.json
```

Imports are atomic, identical records are skipped, and conflicting existing
records are rejected. Use a new release ID for revisions. Normalized timestamps
and decimal string formatting must remain stable on reimport. Supply a complete
boundary set in one bundle if expected_count is set. Full geometry topology
validation (self-intersections, overlaps) is deferred to GIS preprocessing; the
importer validates types, closed rings and coordinate ranges only.

## Comparison and source rules

Use api.services.get_observations with explicit geography, indicator and source.
comparable_values rejects mixed geographies/definitions/releases and unavailable
measurements. It is intentionally conservative: reviewed comparisons across
releases need an explicit future harmonization layer. Never sum medians, average
percentages without denominators, or join 140 to 158 by name/code. No automatic
boundary crosswalk is supplied. CMHC zones/CMA statistics and CPI broader-area
indices remain on their native geographies; never relabel them as neighbourhood
observations. Show coverage in the UI. CPI adjustment requires an explicitly
chosen compatible series, period and base; do not overwrite nominal observations.
Housing burden should use the source-published definition/universe rather than
ratio of unrelated median costs and median incomes. Census year and reference
year differ: 2021 Census income generally references 2020 while shelter costs
reference 2021. Store them independently for each indicator.

Authoritative starting points (download/version/coverage still require review):

- https://www.toronto.ca/city-government/data-research-maps/neighbourhoods-communities/neighbourhood-profiles/
- https://www.toronto.ca/city-government/data-research-maps/ward-profiles/
- https://www12.statcan.gc.ca/census-recensement/2021/ref/98-500/004/98-500-x2021004-eng.pdf
- https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data
- https://www.statcan.gc.ca/en/subjects-start/prices_and_price_indexes/consumer_price_indexes

Next source-specific adapters should be built against actual downloaded files and
verified source codes. Start with one complete Toronto boundary version and its
matching population/income/shelter-cost release, then add other vintages, amenities,
GTFS stops, CPI and CMHC as separate releases. This foundation has no new HTTP
endpoint; backend feature services can use the ORM without changing current routes.

`SourceTableRow` preserves complete source rows with a release, original locator, label,
metadata and cells. These staging records are explicitly outside reviewed comparison
indicators. See [official imports](official-data-import.md) for the preparation pipeline.
