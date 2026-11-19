"""Zoning shares inside a neighbourhood. Synthetic fixtures only."""
from django.test import TestCase

from . import land_use
from .models import Geography, GeographySet, SourceRelease, SourceTableRow

LON_PER_M, LAT_PER_M = 1 / (111_320 * 0.7230), 1 / 110_574


def rect(west_m, south_m, width_m, height_m, at=(-79.4, 43.7)):
    w, s = at[0] + west_m * LON_PER_M, at[1] + south_m * LAT_PER_M
    e, n = w + width_m * LON_PER_M, s + height_m * LAT_PER_M
    return {"type": "MultiPolygon", "coordinates": [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]]}


class LandUseTests(TestCase):
    url = "/api/land-use/"

    def setUp(self):
        land_use._zones.cache_clear()
        self.addCleanup(land_use._zones.cache_clear)
        source = SourceRelease.objects.create(id="boundaries-test", publisher="Test", title="Boundaries", url="https://example.org",
            licence="Test", retrieved_at="2026-01-01T00:00:00Z", sha256="a" * 64, coverage="Test")
        GeographySet.objects.create(id="toronto-158", kind="neighbourhood", version="158", source=source)
        # A 1000 m x 1000 m neighbourhood.
        Geography.objects.create(id="toronto-158-1", geography_set_id="toronto-158", code="1", name="Test area",
                                 geometry={"type": "Polygon", "coordinates": rect(0, 0, 1000, 1000)["coordinates"][0]})

    def load(self, *zones):
        SourceRelease.objects.create(id="zoning-areas-geojson-test", publisher="City of Toronto", title="Zoning By-law 569-2013 zoning areas",
            url="https://example.org", licence="Test", retrieved_at="2026-11-19T00:00:00Z", sha256="b" * 64, coverage="Test")
        for n, (gen_zone, status, zone, geometry) in enumerate(zones):
            SourceTableRow.objects.create(source_id="zoning-areas-geojson-test", locator=f"feature/{n}", label=zone,
                cells={"properties": {"_id": n, "GEN_ZONE": gen_zone, "ZN_STATUS": status, "ZN_STRING": zone}, "geometry": geometry})

    def get(self, geography_id="toronto-158-1"):
        return self.client.get(self.url, {"geography_id": geography_id})

    def test_shares_are_clipped_to_the_neighbourhood(self):
        self.load((0, 2, "RD", rect(0, 0, 1000, 600)),          # 60% residential
                  (1, 0, "O", rect(0, 600, 500, 400)),          # 20% open space
                  (4, 2, "E", rect(500, 600, 1500, 400)))       # 1500 m wide, only 500 m inside: 20%
        data = self.get().json()
        self.assertEqual([(s["category"], s["percent"]) for s in data["shares"]],
                         [("residential", 60.0), ("open_space", 20.0), ("employment", 20.0)])
        self.assertEqual(data["not_covered_percent"], 0.0)
        self.assertEqual(len(data["features"]["features"]), 3)
        self.assertEqual(data["features"]["features"][0]["properties"], {"category": "residential", "label": "Residential", "zone": "RD"})
        self.assertEqual(data["as_of"], "2026-11-19")

    def test_unzoned_land_is_not_covered_and_lands_outside_the_bylaw_are_left_out(self):
        self.load((0, 2, "RD", rect(0, 0, 1000, 500)),          # 50% residential
                  (201, 5, "CL", rect(0, 500, 1000, 250)))      # status 5: not in By-law 569-2013
        data = self.get().json()
        self.assertEqual([(s["category"], s["percent"]) for s in data["shares"]], [("residential", 50.0)])
        self.assertEqual(data["not_covered_percent"], 50.0)

    def test_unzoned_city_park_is_reported_separately_from_other_unzoned_land(self):
        self.load((0, 2, "RD", rect(0, 0, 1000, 500)))           # 50% residential; the rest has no zone
        SourceRelease.objects.create(id="toronto-green-spaces-test", publisher="City of Toronto", title="Green Spaces",
            url="https://example.org", licence="Test", retrieved_at="2026-11-14T00:00:00Z", sha256="c" * 64, coverage="Test")
        park = rect(0, 400, 1000, 400)                            # 30% of the area falls in the unzoned half
        SourceTableRow.objects.create(source_id="toronto-green-spaces-test", locator="feature/1", label="Big park",
            cells={"properties": {"AREA_ID": 1, "AREA_CLASS": "Park", "AREA_NAME": "BIG PARK"},
                   "geometry": {"type": "Polygon", "coordinates": park["coordinates"][0]}})
        from . import parks
        parks._parks.cache_clear()
        self.addCleanup(parks._parks.cache_clear)
        data = self.get().json()
        self.assertEqual([(s["category"], s["percent"]) for s in data["shares"]], [("residential", 50.0), ("unzoned_park", 30.0)])
        self.assertEqual(data["not_covered_percent"], 20.0)
        self.assertEqual(data["park_source"], {"title": "Green Spaces", "publisher": "City of Toronto"})

    def test_not_loaded_is_reported_not_zero(self):
        data = self.get().json()
        self.assertEqual((data["category_loaded"], data["shares"], data["not_covered_percent"]), (False, [], None))

    def test_requires_a_known_neighbourhood(self):
        self.assertEqual(self.client.get(self.url).status_code, 400)
        self.load()
        self.assertEqual(self.get("toronto-158-999").status_code, 404)
