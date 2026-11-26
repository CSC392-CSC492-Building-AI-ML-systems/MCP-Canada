"""Exercise the comparison endpoint using source-native synthetic observations."""
from decimal import Decimal

from django.test import TestCase

from .models import Geography, GeographySet, Indicator, Observation
from .test_sidebar_api import source


class SidebarComparisonTests(TestCase):
    url = "/api/comparison/"
    historical_id = "census-2011-csv-2fc83b4b8e"

    @classmethod
    def setUpTestData(cls):
        cls.release = source("comparison-fixture")
        cls.historical = source(cls.historical_id)
        cls.cmhc = source("cmhc-toronto-2025-xlsx-99ad5966be")
        for set_id in ("toronto-140", "toronto-158"):
            GeographySet.objects.create(id=set_id, kind="neighbourhood", version="fixture", source=cls.release)
            for index, name in enumerate(("Alpha", "Beta", "Gamma", "Delta", "Epsilon"), 1):
                Geography.objects.create(id=f"{set_id}-{index}", geography_set_id=set_id, code=str(index), name=name)
        GeographySet.objects.create(id="cmhc-fixture", kind="cma", version="fixture", source=cls.cmhc)
        Geography.objects.create(id="cmhc-fixture-cma", geography_set_id="cmhc-fixture", code="cma", name="Toronto CMA")
        Indicator.objects.create(id="rent", label="Rent", unit="CAD/month", definition="Fixture",
                                 universe="Test only", statistic="average", dimensions={"tenure": "renter"})
        for index, status, value in [(1, "observed", 0), (2, "suppressed", None), (3, "observed", 1700)]:
            Observation.objects.create(source=cls.release, geography_id=f"toronto-158-{index}", indicator_id="rent",
                                       reference_year=2021, census_year=2021, period="annual", value=value, status=status)
            Observation.objects.create(source=cls.historical, geography_id=f"toronto-140-{index}", indicator_id="rent",
                                       reference_year=2011, census_year=2011, period="annual", value=value, status=status)

    def query(self, **overrides):
        return {"geography_ids": "toronto-158-1,toronto-158-2,toronto-158-3",
                "indicator_ids": "rent", "source_id": self.release.id, **overrides}

    def get(self, **overrides):
        return self.client.get(self.url, self.query(**overrides))

    def test_returns_selected_places_and_preserves_suppression(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual({g["id"] for g in body["geographies"]},
                         {"toronto-158-1", "toronto-158-2", "toronto-158-3"})
        by_id = {r["geography_id"]: r for r in body["observations"]}
        self.assertEqual(Decimal(by_id["toronto-158-1"]["value"]), 0)
        self.assertEqual(by_id["toronto-158-2"]["status"], "suppressed")
        self.assertIsNone(by_id["toronto-158-2"]["value"])
        self.assertIsNone(body["budget"])
        self.assertIsNone(body["housing_rent"])

    def test_requires_three_distinct_places(self):
        for ids in ("", "toronto-158-1", "toronto-158-1,toronto-158-1,toronto-158-2"):
            with self.subTest(ids=ids):
                self.assertEqual(self.get(geography_ids=ids).status_code, 400)

    def test_allows_five_places(self):
        response = self.get(geography_ids=",".join(f"toronto-158-{i}" for i in range(1, 6)))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["geographies"]), 5)

    def test_rejects_six_places(self):
        self.assertEqual(self.get(geography_ids=",".join(f"toronto-158-{i}" for i in range(1, 7))).status_code, 400)

    def test_trims_and_deduplicates_ids(self):
        response = self.get(geography_ids=" toronto-158-1 ,toronto-158-2,toronto-158-3,toronto-158-1",
                            indicator_ids=" rent, rent ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["indicators"]), 1)
        self.assertEqual(len(response.json()["observations"]), 3)

    def test_requires_indicator_and_source(self):
        for query in ({"indicator_ids": ""}, {"source_id": ""}, {"source_id": "   "}):
            with self.subTest(query=query):
                self.assertEqual(self.get(**query).status_code, 400)

    def test_limits_indicator_count(self):
        response = self.get(indicator_ids=",".join(f"indicator-{i}" for i in range(21)))
        self.assertEqual(response.status_code, 400)

    def test_rejects_unknown_neighbourhood(self):
        self.assertEqual(self.get(geography_ids="toronto-158-1,toronto-158-2,unknown").status_code, 400)

    def test_rejects_non_current_selection_ids(self):
        self.assertEqual(self.get(geography_ids="toronto-140-1,toronto-158-2,toronto-158-3").status_code, 400)

    def test_rejects_unknown_indicator(self):
        self.assertEqual(self.get(indicator_ids="unknown").status_code, 400)

    def test_historical_source_uses_historical_geographies(self):
        response = self.get(source_id=self.historical_id)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(r["geography_id"].startswith("toronto-140-") for r in response.json()["observations"]))
        self.assertTrue(all(r["reference_year"] == 2011 for r in response.json()["observations"]))

    def test_incomplete_historical_mapping_is_explicit(self):
        Geography.objects.filter(pk="toronto-140-3").update(name="Different historical area")
        response = self.get(source_id=self.historical_id)
        self.assertEqual(response.status_code, 400)
        self.assertIn("mapping is incomplete", response.json()["error"])

    def test_unknown_release_does_not_borrow_other_source_values(self):
        response = self.get(source_id="unknown-release")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["observations"], [])

    def test_budget_is_returned_in_monthly_units(self):
        response = self.get(before_tax_income="6000", monthly_rent="2400", bedrooms="2")
        self.assertEqual(response.json()["budget"], {"monthly_income": 6000, "monthly_rent": 2400, "bedrooms": 2})
        self.assertIsNone(response.json()["housing_rent"])

    def test_partial_budget_keeps_optional_income_unknown(self):
        response = self.get(monthly_rent="2000")
        self.assertEqual(response.json()["budget"], {"monthly_income": None, "monthly_rent": 2000, "bedrooms": 0})

    def test_rejects_invalid_budget_inputs(self):
        for params in ({"before_tax_income": "-1"}, {"monthly_rent": "-1"}, {"bedrooms": "6"},
                       {"bedrooms": "two"}, {"before_tax_income": "NaN"}, {"monthly_rent": "Infinity"}):
            with self.subTest(params=params):
                response = self.get(**params)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "Invalid budget preferences.")

    def test_bedroom_specific_cma_rent_is_separate_from_neighbourhood_rows(self):
        for bedrooms, category in ((0, "studio"), (1, "1"), (2, "2"), (3, "3plus"), (4, "3plus"), (5, "3plus")):
            indicator, _ = Indicator.objects.get_or_create(
                id=f"cmhc-2025-apartment-rent-{category}", defaults={
                    "label": category, "unit": "CAD/month", "definition": "Fixture", "universe": "CMA", "statistic": "average"})
            Observation.objects.get_or_create(
                source=self.cmhc, geography_id="cmhc-fixture-cma", indicator=indicator,
                reference_year=2025, period="2025-10", defaults={"value": 2400, "status": "observed"})
            with self.subTest(bedrooms=bedrooms):
                body = self.get(bedrooms=str(bedrooms)).json()
                self.assertEqual(body["housing_rent"], {"value": 2400, "bedrooms": bedrooms, "reference_year": 2025, "geography": "Toronto CMA"})
                self.assertTrue(all(r["geography_id"].startswith("toronto-158-") for r in body["observations"]))

    def test_suppressed_cma_rent_is_not_used_as_zero(self):
        indicator = Indicator.objects.create(id="cmhc-2025-apartment-rent-2", label="Fixture", unit="CAD/month")
        Observation.objects.create(source=self.cmhc, geography_id="cmhc-fixture-cma", indicator=indicator,
                                   reference_year=2025, period="2025-10", value=None, status="suppressed")
        self.assertIsNone(self.get(bedrooms="2").json()["housing_rent"])

    def test_rejects_post(self):
        self.assertEqual(self.client.post(self.url, self.query()).status_code, 405)
