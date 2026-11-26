"""Zoning (land use) inside one neighbourhood, from City of Toronto Zoning By-law 569-2013.

Zoning says what land is zoned for, not what is built on it today, and it is a present-day
snapshot (amendments to June 18, 2023), not historical. Zone polygons are the staged
source rows imported by backend/scripts/prepare_official_data.py. For a neighbourhood they
are clipped to its boundary, and each category's share of the neighbourhood's area is
measured on a local metre projection. Land with no zone in the file (usually road
allowances, rail and water, or lands still under a former by-law) is reported as not
covered, never assigned a zone. Large City parks such as High Park are not in the zoning
file, so unzoned land that is a City park in the Green Spaces snapshot (see parks.py) is
reported separately as "City park, not in the zoning file", from that source.
"""
from __future__ import annotations

from functools import lru_cache

from shapely import STRtree, make_valid, unary_union
from shapely.geometry import mapping, shape
from shapely.ops import transform

from . import parks
from .models import Geography, SourceRelease, SourceTableRow

SOURCE_PREFIX = "zoning-areas-geojson-"
# GEN_ZONE code -> (category key, label), from the dataset's README.
CATEGORIES = {
    0: ("residential", "Residential"),
    101: ("residential_apartment", "Residential apartment"),
    202: ("commercial_residential", "Commercial residential (mixed use)"),
    201: ("commercial", "Commercial"),
    6: ("commercial_residential_employment", "Commercial, residential and employment"),
    4: ("employment", "Employment industrial"),
    5: ("institutional", "Institutional"),
    1: ("open_space", "Open space"),
    2: ("utility_transportation", "Utility and transportation"),
}
UNZONED_PARK = ("unzoned_park", "City park, not in the zoning file")
NOT_IN_BYLAW = 5  # ZN_STATUS: lands not part of By-law 569-2013 (the README says to hide them)
_M_X, _M_Y = 111_320 * 0.7230, 110_574  # metres per degree at Toronto, as in the import


class LandUseUnavailable(Exception):
    """The zoning snapshot is not loaded, or more than one release is."""


def _metres(geometry):
    return transform(lambda x, y, z=None: (x * _M_X, y * _M_Y), geometry)


def _release():
    releases = list(SourceRelease.objects.filter(id__startswith=SOURCE_PREFIX).values("id", "title", "publisher", "retrieved_at"))
    if len(releases) != 1:
        raise LandUseUnavailable("A single City of Toronto zoning release is not loaded.")
    return releases[0]


@lru_cache(maxsize=2)
def _zones(source_id: str):
    """(category, label, zone label, shape) for every zone in By-law 569-2013, and a spatial index."""
    zones = []
    for cells in SourceTableRow.objects.filter(source_id=source_id).values_list("cells", flat=True).iterator():
        p, geometry = cells.get("properties", {}), cells.get("geometry")
        if not geometry or p.get("ZN_STATUS") == NOT_IN_BYLAW or p.get("GEN_ZONE") not in CATEGORIES:
            continue
        key, label = CATEGORIES[p["GEN_ZONE"]]
        zones.append((key, label, p.get("ZN_STRING") or "", make_valid(shape(geometry))))
    return zones, STRtree([z[3] for z in zones])


def land_use(geography_id: str) -> dict:
    """Zoning clipped to one neighbourhood, with each category's share of its area."""
    boundary_json = Geography.objects.filter(id=geography_id).values_list("geometry", flat=True).first()
    if not boundary_json:
        raise LookupError(f"Unknown neighbourhood or no boundary: {geography_id}")
    release = _release()
    zones, tree = _zones(release["id"])
    boundary = make_valid(shape(boundary_json))
    total = _metres(boundary).area
    areas: dict[str, float] = {}
    features = []
    for i in sorted(tree.query(boundary, predicate="intersects")):
        key, label, zone, geometry = zones[i]
        part = geometry.intersection(boundary)
        if part.is_empty or part.area == 0:
            continue
        areas[key] = areas.get(key, 0.0) + _metres(part).area
        features.append({
            "type": "Feature",
            # About 2 m of simplification keeps the layer light; areas use the exact clipped shape.
            "geometry": mapping(part.simplify(0.00002, preserve_topology=True)),
            "properties": {"category": key, "label": label, "zone": zone},
        })
    # Unzoned land that is a City park: measured from the Green Spaces park polygons, not zoning.
    park_source = None
    try:
        park_release = parks._release()
    except parks.ParksUnavailable:
        park_release = None
    if park_release:
        _, _, park_shapes, _, _ = parks._parks(park_release["id"])
        zoned = unary_union([zones[i][3] for i in tree.query(boundary, predicate="intersects")])
        gap = boundary.difference(zoned)
        hits = [g.intersection(gap) for g in park_shapes if g.intersects(gap)]
        park_gap = unary_union(hits) if hits else None
        if park_gap is not None and not park_gap.is_empty and park_gap.area > 0:
            areas[UNZONED_PARK[0]] = _metres(park_gap).area
            features.append({"type": "Feature", "geometry": mapping(park_gap.simplify(0.00002, preserve_topology=True)),
                             "properties": {"category": UNZONED_PARK[0], "label": UNZONED_PARK[1], "zone": ""}})
            park_source = {"title": park_release["title"], "publisher": park_release["publisher"]}
    labels = {**dict(CATEGORIES.values()), UNZONED_PARK[0]: UNZONED_PARK[1]}
    shares = [{"category": key, "label": labels[key], "percent": round(area / total * 100, 1)}
              for key, area in sorted(areas.items(), key=lambda kv: -kv[1])]
    covered = sum(areas.values()) / total * 100 if total else 0.0
    return {
        "category_loaded": True,
        "geography_id": geography_id,
        "features": {"type": "FeatureCollection", "features": features},
        "shares": shares,
        # Roads, rail, water and lands under former by-laws: no zone in this file and not a City park.
        "not_covered_percent": round(max(0.0, 100 - covered), 1),
        "as_of": release["retrieved_at"].date().isoformat(),
        "source": {"title": release["title"], "publisher": release["publisher"]},
        # Set when some unzoned land was identified as City park from the Green Spaces snapshot.
        "park_source": park_source,
    }
