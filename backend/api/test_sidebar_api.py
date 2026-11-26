"""Sidebar API contracts with synthetic data, isolated from the imported database."""
import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, SimpleTestCase

from .models import Geography, GeographySet, Indicator, Observation, Place, SourceRelease
from . import transit


def source(source_id):
    return SourceRelease.objects.create(
        id=source_id, publisher="Synthetic publisher", title=source_id,
        url="https://example.org/fixture", licence="Test only",
        retrieved_at="2026-01-01T00:00:00Z", sha256="a" * 64, coverage="Synthetic area",
    )


class SidebarDataApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.source = source("sidebar-fixture")
        cls.other_source = source("other-release")
        for set_id in ("toronto-140", "toronto-158"):
            GeographySet.objects.create(id=set_id, kind="neighbourhood", version=set_id, source=cls.source)
            for index, name in enumerate(("Alpha", "Beta", "Gamma", "Delta", "Epsilon"), 1):
                Geography.objects.create(id=f"{set_id}-{index}", geography_set_id=set_id,
                                         code=str(index), name=name)
        for indicator_id in ("rent", "population"):
            Indicator.objects.create(id=indicator_id, label=indicator_id, unit="CAD/month",
                                     definition="Synthetic", universe="Test", statistic="average")
        for geo, src, indicator, year, period, value, status in [
            ("toronto-158-1", cls.source, "rent", 2021, "annual", "0", "observed"),
            ("toronto-158-1", cls.source, "rent", 2020, "2020-10", "1234.56789012", "observed"),
            ("toronto-158-2", cls.source, "rent", 2021, "annual", None, "suppressed"),
            ("toronto-158-3", cls.source, "rent", 2021, "annual", None, "missing"),
            ("toronto-158-4", cls.source, "rent", 2021, "annual", None, "not_applicable"),
            ("toronto-140-1", cls.source, "rent", 2021, "annual", "900", "observed"),
            ("toronto-158-1", cls.other_source, "rent", 2021, "annual", "9999", "observed"),
            ("toronto-158-1", cls.source, "population", 2021, "annual", "50", "observed"),
        ]:
            Observation.objects.create(source=src, geography_id=geo, indicator_id=indicator,
                                       census_year=2021, reference_year=year, period=period,
                                       value=value, status=status, source_locator="fixture/row/1", notes="fixture provenance")

    def query(self, **overrides):
        return {"source_id": self.source.id, "geography_id": "toronto-158-1",
                "indicator_id": "rent", **overrides}

    def batch(self, **overrides):
        return {"source_id": self.source.id, "geography_set_id": "toronto-158",
                "indicator_id": "rent", **overrides}

    def test_observations_require_each_filter(self):
        for key in self.query():
            query = self.query()
            del query[key]
            with self.subTest(key=key):
                response = self.client.get("/api/observations/", query)
                self.assertEqual(response.status_code, 400)
                self.assertIn(key, response.json()["error"])

    def test_observations_trim_query_values(self):
        response = self.client.get("/api/observations/", {k: f" {v} " for k, v in self.query().items()})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["observations"]), 2)

    def test_observations_keep_zero_and_decimal_precision(self):
        rows = self.client.get("/api/observations/", self.query()).json()["observations"]
        self.assertEqual([r["value"] for r in rows], ["1234.56789012", "0E-8"])
        self.assertEqual(rows[1]["status"], "observed")

    def test_observations_preserve_reference_year_and_provenance(self):
        rows = self.client.get("/api/observations/", self.query()).json()["observations"]
        self.assertEqual((rows[0]["census_year"], rows[0]["reference_year"], rows[0]["period"]), (2021, 2020, "2020-10"))
        self.assertEqual(rows[0]["source_locator"], "fixture/row/1")
        self.assertEqual(rows[0]["notes"], "fixture provenance")

    def test_observations_do_not_mix_releases(self):
        rows = self.client.get("/api/observations/", self.query(source_id=self.other_source.id)).json()["observations"]
        self.assertEqual([Decimal(r["value"]) for r in rows], [Decimal("9999")])

    def test_observations_do_not_mix_indicators(self):
        rows = self.client.get("/api/observations/", self.query(indicator_id="population")).json()["observations"]
        self.assertEqual([Decimal(r["value"]) for r in rows], [Decimal("50")])

    def test_observations_do_not_mix_boundary_sets(self):
        rows = self.client.get("/api/observations/", self.query(geography_id="toronto-140-1")).json()["observations"]
        self.assertEqual([Decimal(r["value"]) for r in rows], [Decimal("900")])

    def test_observations_preserve_all_unavailable_statuses(self):
        for index, status in [(2, "suppressed"), (3, "missing"), (4, "not_applicable")]:
            with self.subTest(status=status):
                rows = self.client.get("/api/observations/", self.query(geography_id=f"toronto-158-{index}")).json()["observations"]
                self.assertIsNone(rows[0]["value"])
                self.assertEqual(rows[0]["status"], status)

    def test_unknown_geography_returns_empty_without_filling(self):
        self.assertEqual(self.client.get("/api/observations/", self.query(geography_id="unknown")).json(), {"observations": []})

    def test_unknown_source_returns_empty_without_substitution(self):
        self.assertEqual(self.client.get("/api/observations/", self.query(source_id="unknown")).json(), {"observations": []})

    def test_unknown_indicator_returns_empty(self):
        self.assertEqual(self.client.get("/api/observations/", self.query(indicator_id="unknown")).json(), {"observations": []})

    def test_single_observation_derived_path_omits_internal_fields(self):
        derived = [{"geography_id": "toronto-140-5", "name": "Epsilon", "value": "100", "status": "observed",
                    "derived": {"relation": "same", "method": "fixture", "parts": []}}]
        with patch("api.views.derived_census.applies", return_value=True), patch("api.views.derived_census.derive", return_value=derived) as derive:
            data = self.client.get("/api/observations/", self.query(geography_id="toronto-140-5")).json()
        self.assertNotIn("geography_id", data["observations"][0])
        self.assertNotIn("name", data["observations"][0])
        self.assertEqual(data["observations"][0]["derived"]["relation"], "same")
        derive.assert_called_once_with(self.source.id, "rent", ["toronto-140-5"])

    def test_stored_observation_takes_precedence_over_derivation(self):
        with patch("api.views.derived_census.derive") as derive:
            self.client.get("/api/observations/", self.query())
        derive.assert_not_called()

    def test_batch_excludes_other_boundaries_sources_and_indicators(self):
        rows = self.client.get("/api/observations/batch/", self.batch()).json()["observations"]
        self.assertEqual(len(rows), 5)
        self.assertTrue(all(r["geography_id"].startswith("toronto-158-") for r in rows))
        self.assertNotIn("9999.00000000", [r["value"] for r in rows])
        self.assertEqual(rows[0]["name"], "Alpha")
        self.assertNotIn("geography__name", rows[0])

    def test_batch_filters_reference_year(self):
        rows = self.client.get("/api/observations/batch/", self.batch(reference_year="2020")).json()["observations"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["period"], "2020-10")

    def test_batch_validates_year(self):
        for value in ("soon", "2021.5", "-1", "2021 OR 1=1"):
            with self.subTest(value=value):
                self.assertEqual(self.client.get("/api/observations/batch/", self.batch(reference_year=value)).status_code, 400)

    def test_batch_derived_path_passes_year_to_service(self):
        with patch("api.views.derived_census.applies", return_value=True), patch("api.views.derived_census.derive", return_value=[]) as derive:
            response = self.client.get("/api/observations/batch/", self.batch(geography_set_id="toronto-140", reference_year="2021"))
        self.assertEqual(response.json(), {"observations": []})
        derive.assert_called_once_with(self.source.id, "rent", reference_year=2021)

    def test_catalog_reports_database_counts_and_dimensions(self):
        Indicator.objects.filter(pk="rent").update(dimensions={"bedrooms": 2})
        with patch("api.views.boundary_links", return_value=[]):
            body = self.client.get("/api/catalog/").json()
        self.assertEqual(body["summary"]["observations"], 8)
        self.assertEqual(body["summary"]["geographies"], 10)
        self.assertEqual(next(i for i in body["indicators"] if i["id"] == "rent")["dimensions"], {"bedrooms": 2})
        self.assertEqual({s["id"] for s in body["sources"]}, {self.source.id, self.other_source.id})

    def test_sidebar_get_endpoints_reject_post(self):
        for url in ("catalog", "observations", "observations/batch", "places", "parks/nearby", "boundaries", "land-use"):
            with self.subTest(url=url):
                self.assertEqual(self.client.post(f"/api/{url}/").status_code, 405)


class SidebarPlacesApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.source = source("amenities-fixture")
        for record, name, lat, lng, category, properties in [
            ("a", "Zebra School", "43.7", "-79.4", "school", {}),
            ("b", "Alpha School", "43.8", "-79.3", "school", {}),
            ("c", "Grocer", "43.7", "-79.4", "grocery", {"tags": {"shop": "supermarket"}}),
        ]:
            Place.objects.create(source=cls.source, source_record_id=record, name=name, latitude=lat,
                                 longitude=lng, category=category, properties=properties, valid_on="2026-01-02")

    def test_places_sorted_and_serialized(self):
        body = self.client.get("/api/places/", {"category": " school "}).json()
        self.assertEqual([p["name"] for p in body["places"]], ["Alpha School", "Zebra School"])
        self.assertEqual(body["places"][0]["valid_on"], "2026-01-02")
        self.assertIsInstance(body["places"][0]["latitude"], float)
        self.assertIsNone(body["places"][0]["kind"])
        self.assertEqual(body["sources"][0]["id"], self.source.id)

    def test_bbox_includes_points_exactly_on_its_edge(self):
        body = self.client.get("/api/places/", {"category": "school", "bbox": "-79.4,43.7,-79.4,43.7"}).json()
        self.assertEqual([p["name"] for p in body["places"]], ["Zebra School"])

    def test_bbox_rejects_non_finite_and_reversed_ranges(self):
        for bbox in ("nan,43,-79,44", "-80,43,inf,44", "-181,43,-79,44",
                     "-80,-91,-79,44", "-79,43,-80,44", "-80,44,-79,43", "1,2,3,4,5"):
            with self.subTest(bbox=bbox):
                self.assertEqual(self.client.get("/api/places/", {"category": "school", "bbox": bbox}).status_code, 400)

    def test_empty_bbox_keeps_loaded_status(self):
        body = self.client.get("/api/places/", {"category": "school", "bbox": "0,0,1,1"}).json()
        self.assertTrue(body["category_loaded"])
        self.assertEqual(body["places"], [])
        self.assertEqual(body["sources"], [])

    def test_unimported_category_is_explicit(self):
        body = self.client.get("/api/places/", {"category": "library"}).json()
        self.assertFalse(body["category_loaded"])

    def test_grocery_subtype_is_preserved(self):
        body = self.client.get("/api/places/", {"category": "grocery"}).json()
        self.assertEqual(body["places"][0]["kind"], "supermarket")


class SidebarTransitValidationTests(SimpleTestCase):
    url = "/api/transit/commute/"
    valid = {"destination": {"lat": 43.7, "lng": -79.4}, "origins": [{"id": "a", "lat": 43.65, "lng": -79.45}]}

    def post(self, body):
        return self.client.post(self.url, json.dumps(body), content_type="application/json")

    def test_invalid_json(self):
        response = self.client.post(self.url, "{", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("JSON", response.json()["error"])

    def test_oversized_request(self):
        self.assertEqual(self.post({"padding": "a" * 20001}).status_code, 413)

    def test_non_object_body(self):
        for body in (None, [], "text", 3):
            with self.subTest(body=body):
                self.assertEqual(self.post(body).status_code, 400)

    def test_destination_requires_numeric_coordinates(self):
        for point in (None, [], {}, {"lat": True, "lng": -79.4}, {"lat": "43.7", "lng": -79.4},
                      {"lat": 43.7, "lng": None}, {"lat": 50, "lng": -79.4}):
            with self.subTest(point=point):
                self.assertEqual(self.post({**self.valid, "destination": point}).status_code, 400)

    def test_origins_list_size(self):
        for origins in (None, {}, [], self.valid["origins"] * 11):
            with self.subTest(origins=origins):
                self.assertEqual(self.post({**self.valid, "origins": origins}).status_code, 400)

    def test_origin_requires_id_and_valid_location(self):
        for origin in ({}, {"id": "", "lat": 43.7, "lng": -79.4}, {"id": 12, "lat": 43.7, "lng": -79.4},
                       {"id": "a", "lat": False, "lng": -79.4}, {"id": "a", "lat": 43.7, "lng": -90}):
            with self.subTest(origin=origin):
                self.assertEqual(self.post({**self.valid, "origins": [origin]}).status_code, 400)

    def test_invalid_arrival_time(self):
        self.assertEqual(self.post({**self.valid, "arrive_by": "noon"}).status_code, 400)

    def test_unavailable_index_returns_actionable_error(self):
        with patch("api.views.transit.load_index", side_effect=transit.TransitUnavailable("Build the schedule index")):
            response = self.post(self.valid)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "error": "Build the schedule index"})

    def test_valid_request_keeps_coordinate_order_and_source_dates(self):
        index = {"feed": {"version": "fixture", "start": "20261101", "end": "20261130"}, "service_date": "2026-11-03"}
        with patch("api.views.transit.load_index", return_value=index), patch("api.views.transit.commute_times", return_value=[{"id": "a", "minutes": 12}]) as calculate:
            response = self.post({**self.valid, "arrive_by": "08:30"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["arrive_by"], "08:30")
        self.assertEqual(data["source"]["valid_to"], "20261130")
        self.assertEqual(data["results"][0]["minutes"], 12)
        calculate.assert_called_once_with(index, (43.7, -79.4), [("a", 43.65, -79.45)], 30600)
