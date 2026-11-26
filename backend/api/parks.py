"""Distances to City parks, measured to the park's edge rather than an invented centre point.

Parks are polygons, so a point (centroid or entrance) would misstate how close a large
park is. Distances here are straight-line metres from a point to the nearest edge of each
park (0 when the point is inside it). Park shapes come from the City of Toronto Green
Spaces snapshot already imported as staged source rows (see
backend/scripts/prepare_official_data.py). The classes and the grouping of polygons
into one park by AREA_ID match the import's "City parks within 1 km" measure.
"""
from __future__ import annotations

from functools import lru_cache

from shapely import STRtree, make_valid, unary_union
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import nearest_points, transform

from .models import SourceRelease, SourceTableRow

PARK_CLASSES = {"Park", "Open Green Space"}  # same as GREEN_PARK_CLASSES in the import
SOURCE_PREFIX = "toronto-green-spaces-"
NEARBY_METRES = 1000
# Local projection to metres at Toronto's latitude, as in the import (<0.5% error across the city).
_M_X, _M_Y = 111_320 * 0.7230, 110_574


class ParksUnavailable(Exception):
    """The Green Spaces snapshot is not loaded, or more than one release is."""


def _metres(geometry):
    return transform(lambda x, y, z=None: (x * _M_X, y * _M_Y), geometry)


def _degrees(geometry):
    return transform(lambda x, y, z=None: (x / _M_X, y / _M_Y), geometry)


@lru_cache(maxsize=2)
def _parks(source_id: str):
    """Every park in one Green Spaces release: (ids, names, WGS84 shapes, metre shapes, tree)."""
    pieces: dict[str, list] = {}
    names: dict[str, str] = {}
    for cells in SourceTableRow.objects.filter(source_id=source_id).values_list("cells", flat=True).iterator():
        properties, geometry = cells.get("properties", {}), cells.get("geometry")
        if properties.get("AREA_CLASS") not in PARK_CLASSES or not geometry:
            continue
        park_id = str(properties["AREA_ID"])
        pieces.setdefault(park_id, []).append(make_valid(shape(geometry)))
        names.setdefault(park_id, (properties.get("AREA_NAME") or "").strip() or "Unnamed park")
    ids = sorted(pieces)
    wgs84 = [unary_union(pieces[i]) for i in ids]
    in_metres = [_metres(g) for g in wgs84]
    return ids, [names[i] for i in ids], wgs84, in_metres, STRtree(in_metres)


def _release():
    releases = list(SourceRelease.objects.filter(id__startswith=SOURCE_PREFIX).values("id", "title", "publisher", "retrieved_at"))
    if len(releases) != 1:
        raise ParksUnavailable("A single City of Toronto Green Spaces release is not loaded.")
    return releases[0]


def nearby_parks(longitude: float, latitude: float, bbox: tuple[float, float, float, float], count: int = 4) -> dict:
    """Parks around a point: the closest few, how many are within 1 km, and the outlines in bbox."""
    release = _release()
    ids, names, wgs84, in_metres, tree = _parks(release["id"])
    origin = _metres(Point(longitude, latitude))
    # Closest parks: everything within 5 km, falling back to the single nearest anywhere.
    candidates = list(tree.query(origin.buffer(5000))) or ([int(tree.nearest(origin))] if ids else [])
    distances = sorted(((in_metres[i].distance(origin), names[i], ids[i]) for i in candidates), key=lambda d: (d[0], d[1]))
    within = len(tree.query(origin, predicate="dwithin", distance=NEARBY_METRES))
    in_view = tree.query(_metres(box(*bbox)), predicate="intersects")
    features = [{
        "type": "Feature",
        # About 5 m of simplification keeps the outlines light enough to send to the browser.
        "geometry": mapping(wgs84[i].simplify(0.00005, preserve_topology=True)),
        "properties": {"park_id": ids[i], "name": names[i], "metres": round(in_metres[i].distance(origin))},
    } for i in sorted(in_view, key=lambda i: ids[i])]
    return {
        "category_loaded": True,
        "within_1km": within,
        # The closest point on each park's edge: where a walking route to the park ends.
        "nearest": [{"park_id": park_id, "name": name, "metres": round(metres),
                     "point": [round(c, 6) for c in _degrees(nearest_points(in_metres[ids.index(park_id)], origin)[0]).coords[0]]}
                    for metres, name, park_id in distances[:count]],
        "features": {"type": "FeatureCollection", "features": features},
        "as_of": release["retrieved_at"].date().isoformat(),
        "source": {"title": release["title"], "publisher": release["publisher"]},
    }
