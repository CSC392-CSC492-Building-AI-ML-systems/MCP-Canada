"""load_crime_from_mcp and compare_crime_sources, with MCP-Canada replaced by fixed answers."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from .management.commands.load_crime_from_mcp import OFFENCES, POPULATION_INDICATOR, SOURCE_ID
from .models import Geography, GeographySet, Indicator, Observation, SourceRelease

LOADER = "api.management.commands.load_crime_from_mcp.fetch_from_mcp_canada"
AREAS = {"1": "West Humber-Clairville", "95": "Annex"}


def answer(year, areas=AREAS, assault=None):
    """A fixed MCP-Canada answer for one year: every offence has 10 incidents at 25.0 per 100k."""
    rows = []
    for code, name in areas.items():
        crimes = {t: {str(year): {"count": 10, "rate_per_100k": 25.0}} for t in OFFENCES}
        if assault is not None:
            crimes["assault"] = assault
        rows.append({"neighbourhood": name, "neighbourhood_number": code,
                     "population_2025": 40000, "crimes": crimes})
    return {"status": "fresh", "error": None, "source": {"reported_at": "2026-11-26T00:00:00+00:00"},
            "data": {"years": [year], "count": len(rows), "neighbourhoods": rows}}


class CrimeFromMcpTests(TestCase):
    def setUp(self):
        self.csv = SourceRelease.objects.create(
            id="crime-rates-csv-test", publisher="Synthetic fixture", title="Not real data",
            url="https://example.org/test", licence="Test only", retrieved_at="2026-01-01T00:00:00Z",
            sha256="a" * 64, coverage="Test")
        GeographySet.objects.create(id="toronto-158", kind="neighbourhood", version="test", source=self.csv)
        for code, name in AREAS.items():
            Geography.objects.create(id=f"toronto-158-{code}", geography_set_id="toronto-158",
                                     code=code, name=name)
        for key in OFFENCES.values():
            for measure in ("count", "rate"):
                Indicator.objects.create(id=f"tps-crime-{key}-{measure}", label=key, unit="x",
                                         definition="Synthetic", universe="Test", statistic=measure)
        Indicator.objects.create(id=POPULATION_INDICATOR, label="pop", unit="persons",
                                 definition="Synthetic", universe="Test", statistic="count")

    def load(self, *args, fetch=None):
        with mock.patch(LOADER, side_effect=fetch or (lambda tool, args, **kw: answer(args["year"]))):
            call_command("load_crime_from_mcp", *args, stdout=StringIO())

    def csv_copy(self, rate="25.04000000"):
        """CSV rows equal to the fixed answer, with the CSV's 8-decimal rates."""
        for o in Observation.objects.filter(source_id=SOURCE_ID):
            Observation.objects.create(
                source=self.csv, geography_id=o.geography_id, indicator_id=o.indicator_id,
                reference_year=o.reference_year, period="annual", status=o.status,
                value=rate if o.indicator_id.endswith("-rate") else o.value, source_locator="csv")

    def test_saves_counts_rates_and_population_for_every_year(self):
        self.load()
        rows = Observation.objects.filter(source_id=SOURCE_ID)
        # 2 areas x 12 years x 9 offences x (count + rate), plus one population per area.
        self.assertEqual(rows.count(), 2 * 12 * 9 * 2 + 2)
        rate = rows.get(geography_id="toronto-158-95", indicator_id="tps-crime-assault-rate", reference_year=2024)
        self.assertEqual((rate.value, rate.status), (25, "observed"))
        population = rows.get(geography_id="toronto-158-95", indicator_id=POPULATION_INDICATOR)
        self.assertEqual((population.reference_year, population.value), (2025, 40000))
        self.assertEqual(SourceRelease.objects.get(id=SOURCE_ID).licence, "Open Government Licence – Ontario")

    def test_year_without_figures_is_missing(self):
        self.load("--year", "2020", fetch=lambda tool, args, **kw: answer(2020, assault={}))
        row = Observation.objects.get(source_id=SOURCE_ID, geography_id="toronto-158-1",
                                      indicator_id="tps-crime-assault-count")
        self.assertEqual((row.value, row.status), (None, "missing"))

    def test_dry_run_saves_nothing(self):
        self.load("--dry-run")
        self.assertFalse(Observation.objects.filter(source_id=SOURCE_ID).exists())

    def test_rerun_replaces_rows(self):
        self.load()
        self.load()
        self.assertEqual(Observation.objects.filter(source_id=SOURCE_ID).count(), 2 * 12 * 9 * 2 + 2)

    def test_unknown_neighbourhood_stops(self):
        wrong = lambda tool, args, **kw: answer(args["year"], areas={"1": "West Humber-Clairville", "999": "Nowhere"})
        with self.assertRaisesRegex(CommandError, "don't match"):
            self.load(fetch=wrong)

    def test_renamed_neighbourhood_stops(self):
        renamed = lambda tool, args, **kw: answer(args["year"], areas={"1": "West Humber-Clairville", "95": "Yorkville"})
        with self.assertRaisesRegex(CommandError, "Yorkville"):
            self.load(fetch=renamed)

    def test_unavailable_stops(self):
        down = lambda tool, args, **kw: {"status": "unavailable", "error": "boom", "source": {}, "data": None}
        with self.assertRaisesRegex(CommandError, "unavailable"):
            self.load(fetch=down)

    def test_compare_accepts_rates_rounded_to_one_decimal(self):
        self.load()
        self.csv_copy(rate="25.04000000")
        out = StringIO()
        call_command("compare_crime_sources", stdout=out)
        self.assertIn("match; 0 different", out.getvalue())

    def test_compare_reports_a_different_rate(self):
        self.load()
        self.csv_copy(rate="25.20000000")
        with self.assertRaisesRegex(CommandError, "Differences"):
            call_command("compare_crime_sources", stdout=StringIO())
