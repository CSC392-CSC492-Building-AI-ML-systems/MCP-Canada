"""How Toronto's 2021 neighbourhoods (158) relate to the earlier ones (140).

In 2021 the City kept 124 neighbourhoods unchanged and split 16 others into 34
smaller ones. Every 2021 neighbourhood lies wholly inside one earlier
neighbourhood, so each 158 area has exactly one 140 "parent":

- ``same``: the boundary did not change (same code and name in both sets).
- ``part``: the 158 area is one piece of a split 140 area.

The links are computed from the boundary geometries by
``manage.py build_boundary_crosswalk`` and committed as
``api/data/toronto_158_to_140.json`` so they can be reviewed and do not depend on
each developer's database.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

CROSSWALK_PATH = Path(__file__).resolve().parent / "data" / "toronto_158_to_140.json"
NEW_SET, OLD_SET = "toronto-158", "toronto-140"
GRID = 24  # sample points per side of each new area's bounding box
MIN_SHARE = 0.95  # share of sample points that must fall in one parent


def _polygons(geometry: dict) -> list:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def _in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[i - 1][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def contains(geometry: dict, x: float, y: float) -> bool:
    """Point-in-polygon for GeoJSON Polygon/MultiPolygon, honouring holes."""
    return any(_in_ring(x, y, polygon[0]) and not any(_in_ring(x, y, hole) for hole in polygon[1:])
               for polygon in _polygons(geometry))


def _bbox(geometry: dict) -> tuple[float, float, float, float]:
    points = [p for polygon in _polygons(geometry) for p in polygon[0]]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def sample_points(geometry: dict, grid: int = GRID) -> list[tuple[float, float]]:
    """Evenly spaced points inside the area (deterministic, unlike random sampling)."""
    west, south, east, north = _bbox(geometry)
    found = []
    for i in range(grid):
        for j in range(grid):
            x = west + (east - west) * (i + 0.5) / grid
            y = south + (north - south) * (j + 0.5) / grid
            if contains(geometry, x, y):
                found.append((x, y))
    return found


def build_links(old: list[dict], new: list[dict]) -> dict[str, dict]:
    """Map each new area id to its parent old area.

    ``old`` and ``new`` hold dicts with id, code, name and geometry. Raises
    ValueError if a new area is not clearly inside a single old area, because a
    straddling area cannot be combined or traced back without estimation.
    """
    same_key = {(o["code"], o["name"].strip().lower()): o["id"] for o in old}
    boxes = [(o, _bbox(o["geometry"])) for o in old]
    links = {}
    for area in new:
        points = sample_points(area["geometry"])
        if not points:
            raise ValueError(f"{area['name']}: no sample point fell inside the boundary")
        counts: dict[str, int] = {}
        for x, y in points:
            parent = next((o["id"] for o, (w, s, e, n) in boxes
                           if w <= x <= e and s <= y <= n and contains(o["geometry"], x, y)), None)
            if parent:
                counts[parent] = counts.get(parent, 0) + 1
        if not counts:
            raise ValueError(f"{area['name']}: lies outside every earlier neighbourhood")
        parent = max(counts, key=counts.get)
        share = counts[parent] / len(points)
        if share < MIN_SHARE:
            raise ValueError(f"{area['name']}: only {share:.0%} lies inside one earlier neighbourhood")
        same = same_key.get((area["code"], area["name"].strip().lower()))
        if same and same != parent:
            raise ValueError(f"{area['name']}: same code and name as {same}, but lies inside {parent}")
        links[area["id"]] = {"parent": parent, "relation": "same" if same else "part"}
    return dict(sorted(links.items()))


@lru_cache(maxsize=1)
def load_links() -> dict[str, dict]:
    """The committed 158 -> 140 links, keyed by 158 geography id."""
    return json.loads(CROSSWALK_PATH.read_text(encoding="utf-8"))["links"]


def children_of(parent_id: str) -> list[str]:
    """The 2021 neighbourhoods that together make up one earlier (140) neighbourhood."""
    return sorted(child for child, link in load_links().items() if link["parent"] == parent_id)


def boundary_links() -> list[dict]:
    """Catalogue form: one entry per 2021 neighbourhood."""
    return [{"id": child, **link} for child, link in load_links().items()]
