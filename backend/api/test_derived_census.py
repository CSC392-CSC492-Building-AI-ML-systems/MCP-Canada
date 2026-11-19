"""2021 Census values on the earlier (140) boundaries. Synthetic fixtures only."""
import json
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase, TestCase

from . import boundary_crosswalk, derived_census
from .boundary_crosswalk import build_links, contains
from .models import Geography, GeographySet, Indicator, Observation, SourceRelease

SOURCE = "census-2021-fixture"
LINKS = {
    "toronto-158-1": {"parent": "toronto-140-1", "relation": "same"},
    "toronto-158-2": {"parent": "toronto-140-2", "relation": "part"},
    "toronto-158-3": {"parent": "toronto-140-2", "relation": "part"},
}
AVG_COST, TENANTS, MEDIAN_COST, POPULATION = (
    "census-2021-row-381", "census-2021-row-376", "census-2021-row-380", "census-2021-row-4")


def square(west, south, size=1):
    return {"type": "Polygon", "coordinates": [[[west, south], [west + size, south], [west + size, south + size],
                                                [west, south + size], [west, south]]]}


class BuildLinksTests(SimpleTestCase):
    old = [dict(id="old-a", code="1", name="A", geometry=square(0, 0, 2)),
           dict(id="old-b", code="2", name="B", geometry=square(2, 0, 2))]

    def test_contains_respects_holes(self):
        ring = square(0, 0, 4)["coordinates"][0]
        hole = square(1, 1, 2)["coordinates"][0]
        donut = {"type": "Polygon", "coordinates": [ring, hole]}
        self.assertTrue(contains(donut, 0.5, 0.5))
        self.assertFalse(contains(donut, 2, 2))

    def test_unchanged_and_split_areas(self):
        new = [dict(id="new-a", code="1", name="a ", geometry=square(0, 0, 2)),     # same code and name
               dict(id="new-b1", code="9", name="B north", geometry=square(2, 1, 1)),
               dict(id="new-b2", code="10", name="B south", geometry=square(3, 0, 1))]
        self.assertEqual(build_links(self.old, new), {
            "new-a": {"parent": "old-a", "relation": "same"},
            "new-b1": {"parent": "old-b", "relation": "part"},
            "new-b2": {"parent": "old-b", "relation": "part"},
        })

    def test_straddling_area_is_refused(self):
        with self.assertRaisesRegex(ValueError, "inside one earlier"):
            build_links(self.old, [dict(id="x", code="9", name="X", geometry=square(1, 0, 2))])

    def test_same_name_in_a_different_place_is_refused(self):
        with self.assertRaisesRegex(ValueError, "same code and name"):
            build_links(self.old, [dict(id="x", code="1", name="A", geometry=square(2.5, 0.5, 1))])


class CommittedCrosswalkTests(SimpleTestCase):
    def test_every_2021_neighbourhood_has_one_earlier_parent(self):
        links = json.loads(boundary_crosswalk.CROSSWALK_PATH.read_text())["links"]
        self.assertEqual(len(links), 158)
        self.assertEqual({link["parent"] for link in links.values()}, {f"toronto-140-{n}" for n in range(1, 141)})
        same = [c for c, link in links.items() if link["relation"] == "same"]
        parts = [link["parent"] for link in links.values() if link["relation"] == "part"]
        self.assertEqual((len(same), len(parts), len(set(parts))), (124, 34, 16))
        # A split neighbourhood has at least two parts and never also an unchanged copy.
        self.assertTrue(all(parts.count(p) >= 2 for p in parts))
        self.assertFalse({links[c]["parent"] for c in same} & set(parts))


@mock.patch.object(boundary_crosswalk, "load_links", lambda: LINKS)
@mock.patch.object(derived_census, "load_links", lambda: LINKS)
class DerivedCensusTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        source = SourceRelease.objects.create(id=SOURCE, publisher="Fixture", title="Not real data",
            url="https://example.org", licence="Test", retrieved_at="2026-01-01T00:00:00Z", sha256="a" * 64,
            coverage="Test")
        for set_id in ("toronto-140", "toronto-158"):
            GeographySet.objects.create(id=set_id, kind="neighbourhood", version=set_id, source=source)
        for gid, name in [("toronto-140-1", "Unchanged"), ("toronto-140-2", "Split"),
                          ("toronto-158-1", "Unchanged"), ("toronto-158-2", "Split north"),
                          ("toronto-158-3", "Split south")]:
            Geography.objects.create(id=gid, geography_set_id=gid.rsplit("-", 1)[0], code=gid.rsplit("-", 1)[1],
                                     name=name)
        for iid, statistic in [(AVG_COST, "average"), (TENANTS, "count"), (MEDIAN_COST, "median"),
                               (POPULATION, "count")]:
            Indicator.objects.create(id=iid, label=iid, unit="x", definition="Synthetic", universe="Test",
                                     statistic=statistic)
        values = {AVG_COST: [1000, 2000, 1000], TENANTS: [50, 100, 300], MEDIAN_COST: [900, 1800, 950],
                  POPULATION: [500, 0, 700]}
        for iid, numbers in values.items():
            for n, value in enumerate(numbers, start=1):
                Observation.objects.create(source=source, geography_id=f"toronto-158-{n}", indicator_id=iid,
                    census_year=2021, reference_year=2021, period="annual", value=Decimal(value),
                    status="observed", source_locator=f"row={iid};col={n}")

    def by_parent(self, indicator):
        return {row["geography_id"]: row for row in derived_census.derive(SOURCE, indicator)}

    def test_unchanged_area_uses_the_identical_published_value(self):
        row = self.by_parent(MEDIAN_COST)["toronto-140-1"]
        self.assertEqual((row["value"], row["status"], row["derived"]["relation"]), ("900", "observed", "same"))

    def test_counts_are_summed_and_zero_is_kept(self):
        row = self.by_parent(POPULATION)["toronto-140-2"]
        self.assertEqual((row["value"], row["derived"]["relation"]), ("700", "combined"))
        self.assertEqual(row["derived"]["parts"], ["Split north", "Split south"])

    def test_average_is_weighted_by_the_households_it_describes(self):
        # (2000 * 100 + 1000 * 300) / 400 = 1250, not the unweighted 1500.
        self.assertEqual(self.by_parent(AVG_COST)["toronto-140-2"]["value"], "1250")

    def test_median_of_a_split_area_is_missing_not_estimated(self):
        row = self.by_parent(MEDIAN_COST)["toronto-140-2"]
        self.assertEqual((row["value"], row["status"], row["derived"]["relation"]), (None, "missing", "not_combined"))
        self.assertIn("cannot be calculated exactly", row["notes"])

    def test_a_missing_part_leaves_the_combined_value_missing(self):
        Observation.objects.filter(geography_id="toronto-158-3", indicator_id=POPULATION).update(
            value=None, status="suppressed")
        row = self.by_parent(POPULATION)["toronto-140-2"]
        self.assertEqual((row["value"], row["status"]), (None, "missing"))
        self.assertIn("Split south", row["notes"])

    def test_missing_weight_leaves_the_average_missing(self):
        Observation.objects.filter(geography_id="toronto-158-2", indicator_id=TENANTS).delete()
        self.assertEqual(self.by_parent(AVG_COST)["toronto-140-2"]["status"], "missing")

    def test_observations_endpoint_derives_only_for_2021_on_140(self):
        params = {"geography_id": "toronto-140-2", "indicator_id": AVG_COST, "source_id": SOURCE}
        rows = self.client.get("/api/observations/", params).json()["observations"]
        self.assertEqual([(r["value"], r["census_year"], r["derived"]["relation"]) for r in rows],
                         [("1250", 2021, "combined")])
        direct = self.client.get("/api/observations/", {**params, "geography_id": "toronto-158-2"}).json()
        self.assertNotIn("derived", direct["observations"][0])

    def test_batch_endpoint_returns_every_earlier_area(self):
        rows = self.client.get("/api/observations/batch/", {
            "geography_set_id": "toronto-140", "indicator_id": AVG_COST, "source_id": SOURCE,
        }).json()["observations"]
        self.assertEqual({r["geography_id"]: r["value"] for r in rows}, {"toronto-140-1": "1000", "toronto-140-2": "1250"})
        self.assertEqual(rows[1]["name"], "Split")
        empty = self.client.get("/api/observations/batch/", {
            "geography_set_id": "toronto-140", "indicator_id": AVG_COST, "source_id": SOURCE, "reference_year": "2020",
        }).json()
        self.assertEqual(empty["observations"], [])

    def test_catalog_lists_boundary_links(self):
        links = self.client.get("/api/catalog/").json()["boundary_links"]
        self.assertIn({"id": "toronto-158-2", "parent": "toronto-140-2", "relation": "part"}, links)
