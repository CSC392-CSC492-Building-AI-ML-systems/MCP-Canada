"""Distances to park edges. Synthetic fixtures only."""
from django.test import TestCase

from . import parks
from .models import SourceRelease, SourceTableRow

# Around 43.7°N one metre is about 0.0000124° of longitude and 0.000009° of latitude.
LON_PER_M, LAT_PER_M = 1 / (111_320 * 0.7230), 1 / 110_574


def square(west_m, south_m, size_m, at=(-79.4, 43.7)):
    w, s = at[0] + west_m * LON_PER_M, at[1] + south_m * LAT_PER_M
    e, n = w + size_m * LON_PER_M, s + size_m * LAT_PER_M
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


class ParksNearbyTests(TestCase):
    url = "/api/parks/nearby/"
    here = {"longitude": -79.4, "latitude": 43.7, "bbox": "-79.45,43.65,-79.35,43.75"}

    def setUp(self):
        parks._parks.cache_clear()
        self.addCleanup(parks._parks.cache_clear)

    def load(self, *features):
        SourceRelease.objects.create(id="toronto-green-spaces-test", publisher="City of Toronto", title="Green Spaces",
            url="https://example.org", licence="Test", retrieved_at="2026-11-14T00:00:00Z", sha256="a" * 64, coverage="Test")
        for n, (area_id, area_class, name, geometry) in enumerate(features):
            SourceTableRow.objects.create(source_id="toronto-green-spaces-test", locator=f"feature/{n}", label=name,
                cells={"properties": {"AREA_ID": area_id, "AREA_CLASS": area_class, "AREA_NAME": name}, "geometry": geometry})

    def get(self, **params):
        return self.client.get(self.url, {**self.here, **params}).json()

    def test_distance_is_to_the_edge_and_zero_inside(self):
        self.load((1, "Park", "Around us", square(-100, -100, 200)),      # contains the point
                  (2, "Park", "East park", square(500, -50, 100)))        # west edge 500 m east
        data = self.get()
        self.assertEqual([(p["name"], p["metres"]) for p in data["nearest"]], [("Around us", 0), ("East park", 500)])
        self.assertEqual(data["within_1km"], 2)
        # A walking route to the east park ends on its west edge, level with the point.
        lon, lat = data["nearest"][1]["point"]
        self.assertAlmostEqual(lon, -79.4 + 500 * LON_PER_M, places=5)
        self.assertAlmostEqual(lat, 43.7, places=5)

    def test_counts_only_parks_within_one_kilometre(self):
        self.load((1, "Park", "Near", square(900, 0, 50)), (2, "Open Green Space", "Far", square(1500, 0, 50)))
        data = self.get()
        self.assertEqual(data["within_1km"], 1)
        self.assertEqual([p["name"] for p in data["nearest"]], ["Near", "Far"])

    def test_pieces_of_one_park_count_once_and_other_green_space_is_ignored(self):
        self.load((7, "Park", "Split park", square(100, 0, 50)), (7, "Park", "Split park", square(300, 0, 50)),
                  (8, "Golf Course", "Golf", square(50, 0, 50)), (9, "Cemetery", "Cemetery", square(60, 0, 50)))
        data = self.get()
        self.assertEqual(data["within_1km"], 1)
        self.assertEqual([(p["name"], p["metres"]) for p in data["nearest"]], [("Split park", 100)])

    def test_outlines_only_inside_the_view(self):
        self.load((1, "Park", "In view", square(100, 0, 50)), (2, "Park", "Outside", square(20_000, 0, 50)))
        data = self.get(bbox="-79.41,43.69,-79.39,43.71")
        self.assertEqual([f["properties"]["name"] for f in data["features"]["features"]], ["In view"])
        self.assertEqual(data["as_of"], "2026-11-14")

    def test_not_loaded_is_reported_not_zero(self):
        data = self.get()
        self.assertEqual((data["category_loaded"], data["within_1km"], data["nearest"]), (False, None, []))

    def test_rejects_missing_or_invalid_coordinates(self):
        self.assertEqual(self.client.get(self.url, {"longitude": "x", "latitude": "43.7", "bbox": "1,2,3,4"}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {**self.here, "bbox": "1,2,3"}).status_code, 400)
        self.assertEqual(self.client.get(self.url, {**self.here, "latitude": "95"}).status_code, 400)
