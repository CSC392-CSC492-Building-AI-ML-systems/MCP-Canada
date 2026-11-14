# Imported data status

Loaded from 23 source snapshots into the local Django/SQLite database (counts from a fresh
`backend/scripts/setup_official_data.py` run).

| Data | Loaded coverage |
|---|---|
| Neighbourhood boundaries | 140 historical + 158 current polygons, kept separately |
| Census profiles | Full source tables for 2001, 2006, 2011, 2016, 2021 |
| Checked Census measurement records | 26,696, including explicitly unavailable cells |
| CMHC | Full Toronto workbooks for 2019–2025 and Canada 2025 workbook; 8,966 checked measurements for 2018–2025 on native zones/CMA |
| CPI | 321 monthly national all-items observations, January 2000–September 2026 |
| School locations | 1,173 source records |
| Physical library branches | 100 source records |
| TTC GTFS stops/locations | 9,826 source records, including stations/entrances distinguished by source location_type |
| Grocery-related OSM objects | 2,128 in the Toronto-area bounding box, including adjacent municipalities; shop type kept (1,405 convenience, 618 supermarket, 105 greengrocer) |
| Park/green-space polygons | 3,274 features (2018 parks file) and 3,383 current City Green Spaces features; no assumed entrances |
| Green-space measures | 596 derived values: parks within 1 km and green-space share for every 140 and 158 neighbourhood (current snapshot) |
| Places within 1 km | 1,192 derived counts (libraries, schools, supermarkets and greengrocers, TTC stops) plus 298 areas-within-1 km for every 140 and 158 neighbourhood (current snapshots) |
| Toronto Police crime rates | 34,286 published counts and rates per 100,000 for 9 offence types, 2014–2025, on the 158 neighbourhoods |

Database totals: **72,355 measurement records** (68,956 numeric, 2,240 missing,
1,159 suppressed), **13,227 place records**, **36,953 original source-table rows**,
**354 indicator definitions**, and **524 versioned geographic records**.

All source values are preserved. Incomplete or apparently misaligned source rows
remain in staging instead of being silently corrected. Full source tables are
stored for later reviewed mappings; their presence does not make every cell a
validated comparison indicator. Full GTFS schedules are retained in the raw ZIP,
while only stops/locations are indexed as places.

The 140 and 158 neighbourhoods, CMHC zones/CMA, and national CPI coverage are
separate. Monetary values are nominal. The 2021 income observations reference
2020; shelter costs reference 2021. Current amenity snapshots do not establish
historical availability. OSM records are not verified unique businesses.

Validation: 11 Django tests, MCP protocol integration, migration consistency,
atomic import, repeat import, exact row counts, boundary versions, availability
constraints, percentage ranges, source geographic coverage and source-cell spot
checks passed in the validation database. The final project database is checked
against the same inventory after import.

See `docs/official-data-import.md` for commands, limitations and source links;
`data/official-sources.json` for exact URLs, checksums and retrieval timestamps.
