"""Tests for inflation adjustment (inflation.py, the /api/cpi/ endpoints and cpi_inventory).

Grouped the way the project plan's testing framework (Section 7, Layer 1) asks for:
normal, boundary and missing-data cases, plus input validation. The fixture CPI uses
round numbers so every expected value can be checked by hand:

    2011: every month 100          -> annual 100
    2016: months average to 110    -> annual 110
    2021: every month 120          -> annual 120  (2011 -> 2021 factor 1.2)
    2015: 11 months only           -> incomplete
    2026: 9 months only            -> incomplete
"""
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from . import inflation
from .inflation import (
    STATUS_ADJUSTED,
    STATUS_NOT_ADJUSTED,
    STATUS_SAME_YEAR,
    YEAR_COMPLETE,
    YEAR_INCOMPLETE,
    AnnualCpi,
    CpiTable,
    InvalidInflationRequest,
    MonthlyCpi,
)
from .models import Geography, GeographySet, Indicator, Observation, SourceRelease


# --------------------------------------------------------------------------- fixtures

def months_for(year, values):
    """MonthlyCpi rows for one year, one per value, starting in January."""
    return [MonthlyCpi(year=year, month=i + 1, value=Decimal(str(v))) for i, v in enumerate(values)]


def fixture_months():
    """The fixture series described in the module docstring."""
    rows = []
    rows += months_for(2011, [100] * 12)
    rows += months_for(2015, [105] * 11)
    rows += months_for(2016, [109, 109, 109, 109, 110, 110, 110, 110, 111, 111, 111, 111])
    rows += months_for(2021, [120] * 12)
    rows += months_for(2026, [130] * 9)
    return rows


def fixture_table():
    """A CpiTable built from the fixture series, with no database."""
    return CpiTable(years=inflation.annual_cpi_from_months(fixture_months()))


def create_cpi_source(source_id="cpi-test", retrieved_at="2026-01-01T00:00:00Z"):
    """A SourceRelease for fixture CPI rows."""
    return SourceRelease.objects.create(
        id=source_id,
        publisher="Synthetic fixture",
        title="Fixture CPI",
        url="https://example.org/cpi",
        licence="Test only",
        retrieved_at=retrieved_at,
        sha256="a" * 64,
        coverage="Test",
    )


def create_cpi_rows(source, months):
    """Store MonthlyCpi rows as observations, the way the real import does."""
    for m in months:
        Observation.objects.create(
            source=source,
            geography_id=inflation.CPI_GEOGRAPHY_ID,
            indicator_id=inflation.CPI_INDICATOR_ID,
            reference_year=m.year,
            period=f"{m.year}-{m.month:02d}",
            value=m.value,
            status="observed",
            source_locator=f"observations/{m.year}-{m.month:02d}-01",
        )


class CpiDatabaseMixin:
    """Creates the CPI indicator, national geography and fixture observations."""

    def setUp(self):
        super().setUp()
        self.source = create_cpi_source()
        Indicator.objects.create(
            id=inflation.CPI_INDICATOR_ID,
            label="Canada all-items CPI, not seasonally adjusted",
            unit="index, 2002=100",
            definition="Fixture",
            universe="Fixture",
            statistic="index",
        )
        GeographySet.objects.create(id="canada-cpi", kind="country", version="test", source=self.source)
        Geography.objects.create(id=inflation.CPI_GEOGRAPHY_ID, geography_set_id="canada-cpi", code="CA", name="Canada")
        create_cpi_rows(self.source, fixture_months())


# --------------------------------------------------------------------------- parsing input

class ParseYearTests(SimpleTestCase):
    """parse_year: whole four-digit years only, with clear messages otherwise."""

    def test_reads_a_plain_year(self):
        self.assertEqual(inflation.parse_year("2011"), 2011)

    def test_reads_a_year_given_as_a_number(self):
        self.assertEqual(inflation.parse_year(2021), 2021)

    def test_ignores_spaces_around_the_year(self):
        self.assertEqual(inflation.parse_year("  2016 "), 2016)

    def test_accepts_the_earliest_and_latest_allowed_years(self):
        self.assertEqual(inflation.parse_year("1900"), 1900)
        self.assertEqual(inflation.parse_year("2100"), 2100)

    def test_rejects_years_just_outside_the_allowed_range(self):
        for raw in ["1899", "2101"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "must be between 1900 and 2100"):
                    inflation.parse_year(raw)

    def test_rejects_a_missing_or_blank_year(self):
        for raw in [None, "", "   "]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "Missing year"):
                    inflation.parse_year(raw)

    def test_rejects_anything_that_is_not_a_whole_year(self):
        for raw in ["twenty", "2011.5", "-2011", "2011a", "1e3"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "must be a whole year"):
                    inflation.parse_year(raw)

    def test_names_the_parameter_in_the_message(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "from_year"):
            inflation.parse_year("", "from_year")


class ParseAmountTests(SimpleTestCase):
    """parse_amount: zero or more, finite, numeric."""

    def test_reads_whole_and_decimal_amounts(self):
        self.assertEqual(inflation.parse_amount("1000"), Decimal("1000"))
        self.assertEqual(inflation.parse_amount("1234.56"), Decimal("1234.56"))

    def test_allows_zero(self):
        self.assertEqual(inflation.parse_amount("0"), Decimal("0"))

    def test_ignores_spaces_around_the_amount(self):
        self.assertEqual(inflation.parse_amount(" 1800 "), Decimal("1800"))

    def test_rejects_a_missing_or_blank_amount(self):
        for raw in [None, "", "  "]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "Missing amount"):
                    inflation.parse_amount(raw)

    def test_rejects_negative_amounts(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "cannot be negative"):
            inflation.parse_amount("-1")

    def test_rejects_text_that_is_not_a_number(self):
        for raw in ["abc", "$1000", "1,000", "12 34"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "must be a number"):
                    inflation.parse_amount(raw)

    def test_rejects_infinite_and_not_a_number_values(self):
        for raw in ["Infinity", "-Infinity", "NaN"]:
            with self.subTest(raw=raw):
                with self.assertRaises(InvalidInflationRequest):
                    inflation.parse_amount(raw)


class ParsePeriodTests(SimpleTestCase):
    """parse_period: only 'YYYY-MM' monthly periods are part of the series."""

    def test_reads_a_monthly_period(self):
        self.assertEqual(inflation.parse_period("2011-01"), (2011, 1))
        self.assertEqual(inflation.parse_period("2021-12"), (2021, 12))

    def test_rejects_months_outside_one_to_twelve(self):
        self.assertIsNone(inflation.parse_period("2011-00"))
        self.assertIsNone(inflation.parse_period("2011-13"))

    def test_rejects_non_monthly_periods(self):
        for period in ["annual", "2011", "2011-1", "11-01", "2011-01-01", "2011/01", "", "abcd-ef"]:
            with self.subTest(period=period):
                self.assertIsNone(inflation.parse_period(period))

    def test_rejects_values_that_are_not_text(self):
        self.assertIsNone(inflation.parse_period(None))
        self.assertIsNone(inflation.parse_period(201101))


class DecimalToStringTests(SimpleTestCase):
    """decimal_to_string: rounds half up and keeps None as None."""

    def test_rounds_half_up(self):
        self.assertEqual(inflation.decimal_to_string(Decimal("1.005"), 2), "1.01")
        self.assertEqual(inflation.decimal_to_string(Decimal("1.004"), 2), "1.00")

    def test_pads_to_the_number_of_places(self):
        self.assertEqual(inflation.decimal_to_string(Decimal("1200"), 2), "1200.00")

    def test_keeps_none(self):
        self.assertIsNone(inflation.decimal_to_string(None, 2))


# --------------------------------------------------------------------------- annual CPI

class AnnualCpiTests(SimpleTestCase):
    """annual_cpi_from_months: averages complete years, never estimates incomplete ones."""

    def setUp(self):
        self.table = inflation.annual_cpi_from_months(fixture_months())

    def test_averages_the_twelve_months_of_a_complete_year(self):
        self.assertEqual(self.table[2011].value, Decimal(100))
        self.assertEqual(self.table[2016].value, Decimal(110))
        self.assertEqual(self.table[2021].value, Decimal(120))

    def test_marks_complete_years(self):
        for year in [2011, 2016, 2021]:
            with self.subTest(year=year):
                self.assertEqual(self.table[year].status, YEAR_COMPLETE)
                self.assertEqual(self.table[year].months_counted, 12)
                self.assertTrue(self.table[year].is_complete)

    def test_gives_no_value_for_a_year_missing_one_month(self):
        self.assertIsNone(self.table[2015].value)
        self.assertEqual(self.table[2015].status, YEAR_INCOMPLETE)
        self.assertEqual(self.table[2015].months_counted, 11)

    def test_gives_no_value_for_the_current_partial_year(self):
        self.assertIsNone(self.table[2026].value)
        self.assertFalse(self.table[2026].is_complete)
        self.assertEqual(self.table[2026].months_counted, 9)

    def test_counts_a_duplicated_month_once_and_keeps_the_first(self):
        rows = months_for(2020, [100] * 12) + [MonthlyCpi(year=2020, month=1, value=Decimal(9999))]
        table = inflation.annual_cpi_from_months(rows)
        self.assertEqual(table[2020].months_counted, 12)
        self.assertEqual(table[2020].value, Decimal(100))

    def test_a_duplicated_month_does_not_complete_a_short_year(self):
        rows = months_for(2020, [100] * 11) + [MonthlyCpi(year=2020, month=11, value=Decimal(100))]
        table = inflation.annual_cpi_from_months(rows)
        self.assertEqual(table[2020].months_counted, 11)
        self.assertIsNone(table[2020].value)

    def test_returns_an_empty_table_for_no_months(self):
        self.assertEqual(inflation.annual_cpi_from_months([]), {})

    def test_works_when_months_are_given_out_of_order(self):
        rows = list(reversed(months_for(2018, [100 + i for i in range(12)])))
        table = inflation.annual_cpi_from_months(rows)
        self.assertEqual(table[2018].value, Decimal("105.5"))

    def test_lists_years_oldest_first(self):
        self.assertEqual(list(self.table), [2011, 2015, 2016, 2021, 2026])

    def test_as_dict_gives_text_values_and_status(self):
        self.assertEqual(self.table[2011].as_dict(),
                         {"year": 2011, "value": "100.0000", "months_counted": 12, "status": YEAR_COMPLETE})
        self.assertEqual(self.table[2026].as_dict()["value"], None)


class CpiTableTests(SimpleTestCase):
    """CpiTable: lookups, ranges and plain-language reasons."""

    def setUp(self):
        self.table = fixture_table()

    def test_value_for_a_complete_year(self):
        self.assertEqual(self.table.value_for(2021), Decimal(120))

    def test_value_for_an_incomplete_or_unknown_year_is_none(self):
        self.assertIsNone(self.table.value_for(2026))
        self.assertIsNone(self.table.value_for(1999))

    def test_complete_years_leaves_out_incomplete_ones(self):
        self.assertEqual(self.table.complete_years(), [2011, 2016, 2021])

    def test_earliest_and_latest_complete_years(self):
        self.assertEqual(self.table.earliest_complete_year(), 2011)
        self.assertEqual(self.table.latest_complete_year(), 2021)

    def test_an_empty_table_has_no_complete_years(self):
        empty = CpiTable()
        self.assertEqual(empty.complete_years(), [])
        self.assertIsNone(empty.latest_complete_year())
        self.assertIsNone(empty.earliest_complete_year())

    def test_reason_for_a_partial_year_counts_its_months(self):
        self.assertEqual(self.table.missing_reason(2026),
                         "2026 has CPI for only 9 of 12 months, so it has no annual average yet.")

    def test_reason_for_a_year_outside_the_series(self):
        self.assertEqual(self.table.missing_reason(1999), "No CPI is published for 1999 in the loaded data.")

    def test_reason_for_a_full_year_without_a_value(self):
        odd = CpiTable(years={2030: AnnualCpi(year=2030, value=None, months_counted=12, status=YEAR_INCOMPLETE)})
        self.assertEqual(odd.missing_reason(2030), "No annual CPI is available for 2030.")


# --------------------------------------------------------------------------- calculations

class AdjustAmountTests(SimpleTestCase):
    """adjust_amount: the project plan's inflation adjustment test and its edge cases."""

    def setUp(self):
        self.table = fixture_table()

    # normal cases
    def test_plan_example_converts_1000_in_2011_to_2021_dollars(self):
        result = inflation.adjust_amount(Decimal(1000), 2011, 2021, self.table)
        self.assertEqual(result.status, STATUS_ADJUSTED)
        self.assertAlmostEqual(float(result.adjusted_value), 1200.0, delta=1)
        self.assertEqual(result.factor, Decimal("1.2"))

    def test_converts_backwards_into_an_earlier_year(self):
        result = inflation.adjust_amount(Decimal(1200), 2021, 2011, self.table)
        self.assertAlmostEqual(float(result.adjusted_value), 1000.0, places=6)

    def test_converts_from_a_middle_year(self):
        result = inflation.adjust_amount(Decimal(1100), 2016, 2021, self.table)
        self.assertAlmostEqual(float(result.adjusted_value), 1200.0, places=6)

    def test_a_round_trip_returns_the_original_amount(self):
        there = inflation.adjust_amount(Decimal(1000), 2011, 2021, self.table)
        back = inflation.adjust_amount(there.adjusted_value, 2021, 2011, self.table)
        self.assertAlmostEqual(float(back.adjusted_value), 1000.0, places=6)

    # boundary cases
    def test_same_year_in_and_out_returns_the_same_value(self):
        result = inflation.adjust_amount(Decimal(1000), 2016, 2016, self.table)
        self.assertEqual(result.status, STATUS_SAME_YEAR)
        self.assertEqual(result.adjusted_value, Decimal(1000))
        self.assertEqual(result.factor, Decimal(1))

    def test_same_year_works_even_without_cpi_for_that_year(self):
        result = inflation.adjust_amount(Decimal(500), 2026, 2026, self.table)
        self.assertEqual(result.status, STATUS_SAME_YEAR)
        self.assertEqual(result.adjusted_value, Decimal(500))

    def test_zero_stays_zero(self):
        result = inflation.adjust_amount(Decimal(0), 2011, 2021, self.table)
        self.assertEqual(result.adjusted_value, Decimal(0))

    # missing data
    def test_a_year_with_no_cpi_is_not_adjusted_and_never_guessed(self):
        result = inflation.adjust_amount(Decimal(1000), 1999, 2021, self.table)
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIsNone(result.adjusted_value)
        self.assertIsNone(result.factor)
        self.assertIn("1999", result.reason)

    def test_a_partial_target_year_is_not_adjusted(self):
        result = inflation.adjust_amount(Decimal(1000), 2011, 2026, self.table)
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("9 of 12 months", result.reason)

    def test_a_year_missing_one_month_is_not_adjusted(self):
        result = inflation.adjust_amount(Decimal(1000), 2015, 2021, self.table)
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("11 of 12 months", result.reason)

    def test_was_adjusted_is_true_only_when_a_value_exists(self):
        self.assertTrue(inflation.adjust_amount(Decimal(1), 2011, 2021, self.table).was_adjusted)
        self.assertTrue(inflation.adjust_amount(Decimal(1), 2011, 2011, self.table).was_adjusted)
        self.assertFalse(inflation.adjust_amount(Decimal(1), 2011, 2026, self.table).was_adjusted)

    def test_as_dict_rounds_money_to_cents_and_the_factor_to_six_places(self):
        result = inflation.adjust_amount(Decimal("1000"), 2016, 2021, self.table).as_dict()
        self.assertEqual(result["original_value"], "1000.00")
        self.assertEqual(result["adjusted_value"], "1090.91")
        self.assertEqual(result["factor"], "1.090909")
        self.assertEqual(result["status"], STATUS_ADJUSTED)
        self.assertIsNone(result["reason"])

    def test_as_dict_for_a_value_that_was_not_adjusted(self):
        result = inflation.adjust_amount(Decimal("1000"), 2011, 2026, self.table).as_dict()
        self.assertIsNone(result["adjusted_value"])
        self.assertIsNone(result["factor"])
        self.assertEqual(result["status"], STATUS_NOT_ADJUSTED)


class InflationBetweenTests(SimpleTestCase):
    """inflation_between and percent_change."""

    def setUp(self):
        self.table = fixture_table()

    def test_prices_rose_twenty_percent_from_2011_to_2021(self):
        self.assertEqual(inflation.inflation_between(2011, 2021, self.table), Decimal(20))

    def test_going_backwards_gives_a_negative_percent(self):
        value = inflation.inflation_between(2021, 2011, self.table)
        self.assertAlmostEqual(float(value), -16.6667, places=3)

    def test_the_same_year_is_zero(self):
        self.assertEqual(inflation.inflation_between(2026, 2026, self.table), Decimal(0))

    def test_a_missing_year_gives_none(self):
        self.assertIsNone(inflation.inflation_between(2011, 2026, self.table))
        self.assertIsNone(inflation.inflation_between(1999, 2021, self.table))

    def test_percent_change_from_zero_is_none(self):
        self.assertIsNone(inflation.percent_change(Decimal(0), Decimal(100)))

    def test_percent_change_up_down_and_flat(self):
        self.assertEqual(inflation.percent_change(Decimal(100), Decimal(125)), Decimal(25))
        self.assertEqual(inflation.percent_change(Decimal(100), Decimal(80)), Decimal(-20))
        self.assertEqual(inflation.percent_change(Decimal(100), Decimal(100)), Decimal(0))


class RealChangeTests(SimpleTestCase):
    """real_change: the change before and after taking out inflation."""

    def setUp(self):
        self.table = fixture_table()

    def test_rent_rising_30_percent_while_prices_rose_20_percent(self):
        result = inflation.real_change(Decimal(1000), Decimal(1300), 2011, 2021, self.table)
        self.assertEqual(result.nominal_change_percent, Decimal(30))
        self.assertEqual(result.inflation_percent, Decimal(20))
        self.assertAlmostEqual(float(result.real_change_percent), 8.3333, places=3)
        self.assertEqual(result.from_value_in_to_year_dollars, Decimal(1200))
        self.assertEqual(result.status, STATUS_ADJUSTED)

    def test_rising_exactly_with_inflation_is_no_real_change(self):
        result = inflation.real_change(Decimal(1000), Decimal(1200), 2011, 2021, self.table)
        self.assertEqual(result.real_change_percent, Decimal(0))

    def test_rising_slower_than_inflation_is_a_real_drop(self):
        result = inflation.real_change(Decimal(1000), Decimal(1100), 2011, 2021, self.table)
        self.assertLess(result.real_change_percent, 0)

    def test_the_same_year_has_equal_nominal_and_real_change(self):
        result = inflation.real_change(Decimal(1000), Decimal(1100), 2016, 2016, self.table)
        self.assertEqual(result.status, STATUS_SAME_YEAR)
        self.assertEqual(result.nominal_change_percent, result.real_change_percent)

    def test_a_missing_year_keeps_the_nominal_change_and_explains_the_rest(self):
        result = inflation.real_change(Decimal(1000), Decimal(1300), 2011, 2026, self.table)
        self.assertEqual(result.nominal_change_percent, Decimal(30))
        self.assertIsNone(result.real_change_percent)
        self.assertIsNone(result.inflation_percent)
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("9 of 12 months", result.reason)

    def test_a_zero_starting_value_has_no_percent_change(self):
        result = inflation.real_change(Decimal(0), Decimal(500), 2011, 2021, self.table)
        self.assertIsNone(result.nominal_change_percent)
        self.assertIsNone(result.real_change_percent)
        self.assertIn("$0", result.reason)

    def test_as_dict_rounds_percentages(self):
        result = inflation.real_change(Decimal(1000), Decimal(1300), 2011, 2021, self.table).as_dict()
        self.assertEqual(result["nominal_change_percent"], "30.00")
        self.assertEqual(result["real_change_percent"], "8.33")
        self.assertEqual(result["inflation_percent"], "20.00")
        self.assertEqual(result["from_value_in_to_year_dollars"], "1200.00")


class TableAsDictTests(TestCase):
    """table_as_dict: the JSON the annual endpoint returns."""

    def setUp(self):
        self.table = fixture_table()

    def test_lists_every_year_by_default(self):
        data = inflation.table_as_dict(self.table)
        self.assertEqual([row["year"] for row in data["years"]], [2011, 2015, 2016, 2021, 2026])

    def test_limits_to_a_range_of_years(self):
        data = inflation.table_as_dict(self.table, start_year=2015, end_year=2021)
        self.assertEqual([row["year"] for row in data["years"]], [2015, 2016, 2021])

    def test_reports_the_complete_year_range_and_method(self):
        data = inflation.table_as_dict(self.table)
        self.assertEqual(data["latest_complete_year"], 2021)
        self.assertEqual(data["earliest_complete_year"], 2011)
        self.assertIn("average of its 12 monthly values", data["method"])
        self.assertIn("Not a Toronto", data["coverage"])
        self.assertIsNone(data["source"])


# --------------------------------------------------------------------------- database loading

class LoadCpiTableTests(CpiDatabaseMixin, TestCase):
    """load_cpi_table reads the stored observations."""

    def test_builds_the_annual_table_from_stored_months(self):
        table = inflation.load_cpi_table()
        self.assertEqual(table.value_for(2011), Decimal(100))
        self.assertEqual(table.value_for(2021), Decimal(120))
        self.assertIsNone(table.value_for(2026))

    def test_names_the_source(self):
        table = inflation.load_cpi_table()
        self.assertEqual(table.source.id, "cpi-test")
        self.assertEqual(table.source.publisher, "Synthetic fixture")

    def test_ignores_rows_that_are_not_monthly(self):
        Observation.objects.create(source=self.source, geography_id=inflation.CPI_GEOGRAPHY_ID,
            indicator_id=inflation.CPI_INDICATOR_ID, reference_year=2011, period="annual",
            value=Decimal(500), status="observed", source_locator="annual")
        self.assertEqual(inflation.load_cpi_table().value_for(2011), Decimal(100))

    def test_a_suppressed_month_leaves_the_year_incomplete(self):
        Observation.objects.filter(period="2021-06").update(value=None, status="suppressed")
        table = inflation.load_cpi_table()
        self.assertIsNone(table.value_for(2021))
        self.assertEqual(table.years[2021].months_counted, 11)

    def test_uses_the_most_recently_retrieved_source(self):
        newer = create_cpi_source("cpi-newer", retrieved_at="2026-06-01T00:00:00Z")
        create_cpi_rows(newer, months_for(2011, [200] * 12))
        table = inflation.load_cpi_table()
        self.assertEqual(table.source.id, "cpi-newer")
        self.assertEqual(table.value_for(2011), Decimal(200))

    def test_can_read_a_named_source(self):
        newer = create_cpi_source("cpi-newer", retrieved_at="2026-06-01T00:00:00Z")
        create_cpi_rows(newer, months_for(2011, [200] * 12))
        self.assertEqual(inflation.load_cpi_table("cpi-test").value_for(2011), Decimal(100))

    def test_reports_the_indicator_label(self):
        self.assertEqual(inflation.cpi_indicator_label(), "Canada all-items CPI, not seasonally adjusted")


class NoCpiLoadedTests(TestCase):
    """Without CPI in the database, nothing is adjusted and the error says how to fix it."""

    def test_load_raises_with_setup_instructions(self):
        with self.assertRaisesMessage(inflation.InflationDataUnavailable, "setup_official_data.py"):
            inflation.load_cpi_table()

    def test_each_endpoint_answers_503(self):
        for url, params in [
            ("/api/cpi/annual/", {}),
            ("/api/cpi/convert/", {"amount": "1000", "from_year": "2011", "to_year": "2021"}),
            ("/api/cpi/real-change/", {"from_value": "1", "to_value": "2", "from_year": "2011", "to_year": "2021"}),
        ]:
            with self.subTest(url=url):
                response = self.client.get(url, params)
                self.assertEqual(response.status_code, 503)
                self.assertIn("not loaded", response.json()["error"])

    def test_the_management_command_fails_clearly(self):
        with self.assertRaisesMessage(CommandError, "not loaded"):
            call_command("cpi_inventory", stdout=StringIO())


# --------------------------------------------------------------------------- endpoints

class CpiAnnualEndpointTests(CpiDatabaseMixin, TestCase):
    """GET /api/cpi/annual/"""

    def test_returns_every_year_with_its_status(self):
        data = self.client.get("/api/cpi/annual/").json()
        statuses = {row["year"]: row["status"] for row in data["years"]}
        self.assertEqual(statuses, {2011: "complete", 2015: "incomplete", 2016: "complete",
                                    2021: "complete", 2026: "incomplete"})
        self.assertEqual(data["latest_complete_year"], 2021)
        self.assertEqual(data["source"]["id"], "cpi-test")

    def test_values_are_text_and_partial_years_have_none(self):
        rows = {row["year"]: row for row in self.client.get("/api/cpi/annual/").json()["years"]}
        self.assertEqual(rows[2021]["value"], "120.0000")
        self.assertIsNone(rows[2026]["value"])
        self.assertEqual(rows[2026]["months_counted"], 9)

    def test_limits_to_a_range_of_years(self):
        data = self.client.get("/api/cpi/annual/", {"start_year": "2016", "end_year": "2021"}).json()
        self.assertEqual([row["year"] for row in data["years"]], [2016, 2021])

    def test_a_blank_range_is_ignored(self):
        data = self.client.get("/api/cpi/annual/", {"start_year": "", "end_year": " "}).json()
        self.assertEqual(len(data["years"]), 5)

    def test_rejects_a_malformed_year(self):
        response = self.client.get("/api/cpi/annual/", {"start_year": "soon"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("start_year", response.json()["error"])

    def test_rejects_a_range_that_runs_backwards(self):
        response = self.client.get("/api/cpi/annual/", {"start_year": "2021", "end_year": "2011"})
        self.assertEqual(response.status_code, 400)

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post("/api/cpi/annual/").status_code, 405)


class CpiConvertEndpointTests(CpiDatabaseMixin, TestCase):
    """GET /api/cpi/convert/"""

    def get(self, **params):
        return self.client.get("/api/cpi/convert/", params)

    def test_converts_the_plan_example(self):
        data = self.get(amount="1000", from_year="2011", to_year="2021").json()
        self.assertEqual(data["adjusted_value"], "1200.00")
        self.assertEqual(data["factor"], "1.200000")
        self.assertEqual(data["status"], "adjusted")
        self.assertEqual(data["source"]["id"], "cpi-test")

    def test_the_same_year_returns_the_same_value(self):
        data = self.get(amount="1000", from_year="2016", to_year="2016").json()
        self.assertEqual(data["adjusted_value"], "1000.00")
        self.assertEqual(data["status"], "same_year")

    def test_a_year_without_cpi_says_not_adjusted_with_a_reason(self):
        response = self.get(amount="1000", from_year="2011", to_year="2026")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "not_adjusted")
        self.assertIsNone(data["adjusted_value"])
        self.assertIn("9 of 12 months", data["reason"])

    def test_each_missing_parameter_is_named(self):
        for missing in ["amount", "from_year", "to_year"]:
            params = {"amount": "1000", "from_year": "2011", "to_year": "2021"}
            params.pop(missing)
            with self.subTest(missing=missing):
                response = self.get(**params)
                self.assertEqual(response.status_code, 400)
                self.assertIn(missing, response.json()["error"])

    def test_rejects_bad_amounts(self):
        for amount in ["abc", "-5", "Infinity"]:
            with self.subTest(amount=amount):
                self.assertEqual(self.get(amount=amount, from_year="2011", to_year="2021").status_code, 400)

    def test_rejects_bad_years(self):
        for year in ["20x1", "1500", "2011.0"]:
            with self.subTest(year=year):
                self.assertEqual(self.get(amount="1000", from_year=year, to_year="2021").status_code, 400)


class CpiRealChangeEndpointTests(CpiDatabaseMixin, TestCase):
    """GET /api/cpi/real-change/"""

    def get(self, **params):
        return self.client.get("/api/cpi/real-change/", params)

    def test_reports_nominal_real_and_inflation(self):
        data = self.get(from_value="1000", to_value="1300", from_year="2011", to_year="2021").json()
        self.assertEqual(data["nominal_change_percent"], "30.00")
        self.assertEqual(data["real_change_percent"], "8.33")
        self.assertEqual(data["inflation_percent"], "20.00")
        self.assertEqual(data["from_value_in_to_year_dollars"], "1200.00")

    def test_a_partial_year_keeps_only_the_nominal_change(self):
        data = self.get(from_value="1000", to_value="1300", from_year="2011", to_year="2026").json()
        self.assertEqual(data["nominal_change_percent"], "30.00")
        self.assertIsNone(data["real_change_percent"])
        self.assertEqual(data["status"], "not_adjusted")

    def test_rejects_missing_or_bad_values(self):
        self.assertEqual(self.get(to_value="1300", from_year="2011", to_year="2021").status_code, 400)
        self.assertEqual(self.get(from_value="x", to_value="1300", from_year="2011", to_year="2021").status_code, 400)
        self.assertEqual(self.get(from_value="1", to_value="-1", from_year="2011", to_year="2021").status_code, 400)


# --------------------------------------------------------------------------- management command

class CpiInventoryCommandTests(CpiDatabaseMixin, TestCase):
    """manage.py cpi_inventory"""

    def run_command(self, *args):
        out = StringIO()
        call_command("cpi_inventory", *args, stdout=out)
        return out.getvalue()

    def test_prints_the_source_and_every_year(self):
        output = self.run_command()
        self.assertIn("Fixture CPI (Synthetic fixture)", output)
        for year in ["2011", "2015", "2016", "2021", "2026"]:
            self.assertIn(year, output)

    def test_summarises_complete_and_incomplete_years(self):
        output = self.run_command()
        self.assertIn("Complete years: 2011–2021 (3 years)", output)
        self.assertIn("Incomplete years (no annual value): 2015, 2026", output)

    def test_limits_to_a_range_of_years(self):
        output = self.run_command("--start-year", "2016", "--end-year", "2016")
        table_lines = [line for line in output.splitlines() if line[:4].isdigit()]
        self.assertEqual([line[:4] for line in table_lines], ["2016"])

    def test_converts_one_amount(self):
        output = self.run_command("--convert", "1000", "--from-year", "2011", "--to-year", "2021")
        self.assertIn("$1000.00 in 2011 dollars is $1200.00 in 2021 dollars (factor 1.200000).", output)

    def test_explains_a_conversion_it_cannot_make(self):
        output = self.run_command("--convert", "1000", "--from-year", "2011", "--to-year", "2026")
        self.assertIn("was not adjusted: 2026 has CPI for only 9 of 12 months", output)

    def test_rejects_a_backwards_range(self):
        with self.assertRaisesMessage(CommandError, "must not be after"):
            self.run_command("--start-year", "2021", "--end-year", "2011")

    def test_rejects_bad_conversion_input(self):
        with self.assertRaises(CommandError):
            self.run_command("--convert", "abc", "--from-year", "2011", "--to-year", "2021")
        with self.assertRaises(CommandError):
            self.run_command("--convert", "1000", "--from-year", "2011")


# =========================================================================== deeper calculations
#
# Extra fixture for the latest-twelve-months cases: 2025 every month 125, so the
# twelve months from 2025-10 to 2026-09 average (3 x 125 + 9 x 130) / 12 = 128.75.

def fixture_table_with_months(extra=None):
    """A CpiTable with annual values and every fixture month."""
    rows = fixture_months() + (extra or [])
    return CpiTable(years=inflation.annual_cpi_from_months(rows), months=inflation.months_by_period(rows))


def fixture_table_with_recent_months():
    """The fixture plus a complete 2025, so the latest twelve months exist."""
    return fixture_table_with_months(months_for(2025, [125] * 12))


class MonthHelperTests(SimpleTestCase):
    """months_by_period, period_label, parse_month_period and previous_month."""

    def test_months_by_period_keys_by_year_and_month(self):
        months = inflation.months_by_period(months_for(2011, [100, 101]))
        self.assertEqual(months, {(2011, 1): Decimal(100), (2011, 2): Decimal(101)})

    def test_months_by_period_keeps_the_first_duplicate(self):
        rows = months_for(2011, [100]) + [MonthlyCpi(year=2011, month=1, value=Decimal(999))]
        self.assertEqual(inflation.months_by_period(rows)[(2011, 1)], Decimal(100))

    def test_period_label_pads_the_month(self):
        self.assertEqual(inflation.period_label(2011, 5), "2011-05")
        self.assertEqual(inflation.period_label(2021, 12), "2021-12")

    def test_parse_month_period_reads_a_month(self):
        self.assertEqual(inflation.parse_month_period(" 2011-05 "), (2011, 5))

    def test_parse_month_period_rejects_missing_input(self):
        for raw in [None, "", "  "]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "Missing period"):
                    inflation.parse_month_period(raw)

    def test_parse_month_period_rejects_other_formats(self):
        for raw in ["2011", "2011-5", "2011-13", "May 2011", "2011-05-01"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "YYYY-MM"):
                    inflation.parse_month_period(raw)

    def test_parse_month_period_rejects_years_out_of_range(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "between 1900 and 2100"):
            inflation.parse_month_period("1850-01")

    def test_previous_month_steps_back_across_a_year(self):
        self.assertEqual(inflation.previous_month(2026, 1), (2025, 12))
        self.assertEqual(inflation.previous_month(2026, 9), (2026, 8))


class AdjustBetweenMonthsTests(SimpleTestCase):
    """adjust_between_months uses the exact monthly CPI."""

    def setUp(self):
        self.table = fixture_table_with_months()

    def test_converts_between_two_months(self):
        result = inflation.adjust_between_months(Decimal(1000), (2011, 5), (2021, 5), self.table)
        self.assertEqual(result.status, STATUS_ADJUSTED)
        self.assertEqual(result.adjusted_value, Decimal(1200))

    def test_uses_the_month_not_the_yearly_average(self):
        result = inflation.adjust_between_months(Decimal(109), (2016, 1), (2016, 12), self.table)
        self.assertEqual(result.adjusted_value, Decimal(111))

    def test_the_same_month_returns_the_same_value(self):
        result = inflation.adjust_between_months(Decimal(500), (2011, 5), (2011, 5), self.table)
        self.assertEqual(result.status, STATUS_SAME_YEAR)
        self.assertEqual(result.adjusted_value, Decimal(500))

    def test_a_month_in_an_incomplete_year_still_works(self):
        result = inflation.adjust_between_months(Decimal(100), (2011, 1), (2026, 9), self.table)
        self.assertEqual(result.adjusted_value, Decimal(130))

    def test_a_missing_starting_month_is_not_adjusted(self):
        result = inflation.adjust_between_months(Decimal(100), (2015, 12), (2021, 5), self.table)
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertEqual(result.reason, "No CPI is published for 2015-12.")

    def test_a_missing_target_month_is_not_adjusted(self):
        result = inflation.adjust_between_months(Decimal(100), (2011, 1), (2026, 12), self.table)
        self.assertEqual(result.reason, "No CPI is published for 2026-12.")

    def test_a_table_without_months_never_adjusts(self):
        result = inflation.adjust_between_months(Decimal(100), (2011, 1), (2021, 1), fixture_table())
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)


class LatestTwelveMonthsTests(SimpleTestCase):
    """latest_trailing_cpi and adjust_to_latest_months."""

    def test_averages_the_latest_twelve_consecutive_months(self):
        trailing = inflation.latest_trailing_cpi(fixture_table_with_recent_months())
        self.assertEqual(trailing.value, Decimal("128.75"))
        self.assertEqual(trailing.first_period, "2025-10")
        self.assertEqual(trailing.last_period, "2026-09")

    def test_the_label_names_the_months(self):
        trailing = inflation.latest_trailing_cpi(fixture_table_with_recent_months())
        self.assertEqual(trailing.label, "the 12 months from 2025-10 to 2026-09")
        self.assertEqual(trailing.as_dict()["value"], "128.7500")

    def test_a_gap_in_the_latest_months_gives_none(self):
        self.assertIsNone(inflation.latest_trailing_cpi(fixture_table_with_months()))

    def test_no_months_gives_none(self):
        self.assertIsNone(inflation.latest_trailing_cpi(fixture_table()))

    def test_a_complete_final_year_is_its_own_latest_twelve_months(self):
        rows = months_for(2021, [120] * 12)
        table = CpiTable(years=inflation.annual_cpi_from_months(rows), months=inflation.months_by_period(rows))
        trailing = inflation.latest_trailing_cpi(table)
        self.assertEqual(trailing.value, Decimal(120))
        self.assertEqual(trailing.first_period, "2021-01")

    def test_converts_into_dollars_of_the_latest_twelve_months(self):
        result, trailing = inflation.adjust_to_latest_months(Decimal(1000), 2011, fixture_table_with_recent_months())
        self.assertEqual(result.status, STATUS_ADJUSTED)
        self.assertEqual(result.adjusted_value, Decimal("1287.5"))
        self.assertEqual(result.to_year, 2026)
        self.assertEqual(trailing.last_period, "2026-09")

    def test_an_incomplete_starting_year_is_not_adjusted(self):
        result, trailing = inflation.adjust_to_latest_months(Decimal(1000), 2015, fixture_table_with_recent_months())
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("11 of 12 months", result.reason)
        self.assertIsNotNone(trailing)

    def test_without_recent_months_nothing_is_adjusted(self):
        result, trailing = inflation.adjust_to_latest_months(Decimal(1000), 2011, fixture_table_with_months())
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("twelve consecutive", result.reason)
        self.assertIsNone(trailing)

    def test_table_as_dict_reports_the_latest_months_or_none(self):
        self.assertIsNone(inflation.latest_twelve_months_dict(fixture_table()))
        self.assertEqual(inflation.latest_twelve_months_dict(fixture_table_with_recent_months())["last_period"], "2026-09")


class RatesAndIndexTests(SimpleTestCase):
    """annualized_inflation, year_over_year and rebase."""

    def setUp(self):
        self.table = fixture_table()

    def test_average_yearly_rate_compounds(self):
        rate = inflation.annualized_inflation(2011, 2021, self.table)
        self.assertAlmostEqual(float(rate), 1.8399, places=3)
        self.assertLess(rate, Decimal(2))

    def test_average_yearly_rate_backwards_is_negative(self):
        rate = inflation.annualized_inflation(2021, 2011, self.table)
        self.assertLess(rate, 0)
        self.assertAlmostEqual(float(rate), -1.8067, places=3)

    def test_average_yearly_rate_for_the_same_year_is_zero(self):
        self.assertEqual(inflation.annualized_inflation(2016, 2016, self.table), Decimal(0))

    def test_average_yearly_rate_is_unknown_without_cpi(self):
        self.assertIsNone(inflation.annualized_inflation(2011, 2026, self.table))

    def test_year_over_year_needs_the_previous_year(self):
        rows = inflation.year_over_year(self.table)
        self.assertEqual([row["year"] for row in rows], [2011, 2016, 2021])
        self.assertTrue(all(row["inflation_percent"] is None for row in rows))

    def test_year_over_year_for_consecutive_years(self):
        table = CpiTable(years=inflation.annual_cpi_from_months(
            months_for(2020, [100] * 12) + months_for(2021, [103] * 12) + months_for(2022, [109.18] * 12)))
        rows = inflation.year_over_year(table)
        self.assertEqual(rows[0]["inflation_percent"], None)
        self.assertEqual(rows[1]["inflation_percent"], "3.00")
        self.assertEqual(rows[2]["inflation_percent"], "6.00")
        self.assertEqual(rows[1]["annual_cpi"], "103.0000")

    def test_rebase_makes_the_base_year_100(self):
        rebased = inflation.rebase(self.table, 2011)
        self.assertEqual(rebased[2011], Decimal(100))
        self.assertEqual(rebased[2021], Decimal(120))

    def test_rebase_to_a_later_year(self):
        rebased = inflation.rebase(self.table, 2021)
        self.assertAlmostEqual(float(rebased[2011]), 83.3333, places=3)

    def test_rebase_only_lists_complete_years(self):
        self.assertEqual(sorted(inflation.rebase(self.table, 2016)), [2011, 2016, 2021])

    def test_rebase_rejects_a_base_year_without_cpi(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "2026 cannot be the base year"):
            inflation.rebase(self.table, 2026)


class CensusReferenceYearTests(SimpleTestCase):
    """census_reference_year and adjust_census_value."""

    def test_census_income_refers_to_the_year_before(self):
        self.assertEqual(inflation.census_reference_year(2021, "income"), 2020)
        self.assertEqual(inflation.census_reference_year(2021, "after_tax_income"), 2020)

    def test_shelter_cost_and_rent_refer_to_the_census_year(self):
        self.assertEqual(inflation.census_reference_year(2021, "shelter_cost"), 2021)
        self.assertEqual(inflation.census_reference_year(2016, "rent"), 2016)

    def test_rejects_an_unknown_measure_and_lists_the_known_ones(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "after_tax_income, income, rent, shelter_cost"):
            inflation.census_reference_year(2021, "height")

    def test_adjusts_income_from_its_reference_year(self):
        result = inflation.adjust_census_value(Decimal(1100), 2017, "income", 2021, fixture_table())
        self.assertEqual(result.from_year, 2016)
        self.assertEqual(result.adjusted_value, Decimal(1200))

    def test_adjusts_shelter_cost_from_the_census_year(self):
        result = inflation.adjust_census_value(Decimal(1000), 2011, "shelter_cost", 2021, fixture_table())
        self.assertEqual(result.adjusted_value, Decimal(1200))

    def test_income_whose_reference_year_has_no_cpi_is_not_adjusted(self):
        result = inflation.adjust_census_value(Decimal(1000), 2011, "income", 2021, fixture_table())
        self.assertEqual(result.status, STATUS_NOT_ADJUSTED)
        self.assertIn("2010", result.reason)


class SeriesTests(SimpleTestCase):
    """parse_series and adjust_series."""

    def test_reads_year_amount_pairs(self):
        self.assertEqual(inflation.parse_series("2011:1000, 2021:1300"),
                         [(2011, Decimal(1000)), (2021, Decimal(1300))])

    def test_skips_empty_items(self):
        self.assertEqual(inflation.parse_series("2011:1000,,"), [(2011, Decimal(1000))])

    def test_rejects_missing_or_empty_input(self):
        for raw in [None, "", " ", ",,"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "Missing values"):
                    inflation.parse_series(raw)

    def test_rejects_an_item_without_one_colon(self):
        for raw in ["2011-1000", "2011:1000:5"]:
            with self.subTest(raw=raw):
                with self.assertRaisesMessage(InvalidInflationRequest, "YEAR:AMOUNT"):
                    inflation.parse_series(raw)

    def test_rejects_a_repeated_year(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "2011 appears more than once"):
            inflation.parse_series("2011:1000,2011:1100")

    def test_rejects_bad_years_and_amounts(self):
        with self.assertRaises(InvalidInflationRequest):
            inflation.parse_series("20x1:1000")
        with self.assertRaises(InvalidInflationRequest):
            inflation.parse_series("2011:-5")

    def test_rejects_more_than_fifty_values(self):
        raw = ",".join(f"{1950 + i}:100" for i in range(51))
        with self.assertRaisesMessage(InvalidInflationRequest, "at most 50"):
            inflation.parse_series(raw)

    def test_adjust_series_sorts_and_converts_each_value(self):
        results = inflation.adjust_series([(2021, Decimal(1300)), (2011, Decimal(1000))], 2021, fixture_table())
        self.assertEqual([r.from_year for r in results], [2011, 2021])
        self.assertEqual([r.status for r in results], [STATUS_ADJUSTED, STATUS_SAME_YEAR])
        self.assertEqual(results[0].adjusted_value, Decimal(1200))

    def test_adjust_series_keeps_values_it_cannot_convert(self):
        results = inflation.adjust_series([(2015, Decimal(1000))], 2021, fixture_table())
        self.assertEqual(results[0].status, STATUS_NOT_ADJUSTED)


class AffordabilityTrendTests(SimpleTestCase):
    """affordability_point, parse_affordability_points and affordability_trend."""

    def setUp(self):
        self.table = fixture_table()

    def test_share_of_income_at_the_guideline(self):
        point = inflation.affordability_point(2021, Decimal(1500), Decimal(60000))
        self.assertEqual(point.share_of_income_percent, Decimal(30))
        self.assertTrue(point.meets_guideline)

    def test_share_of_income_over_the_guideline(self):
        point = inflation.affordability_point(2021, Decimal(2300), Decimal(72000))
        self.assertAlmostEqual(float(point.share_of_income_percent), 38.333, places=2)
        self.assertFalse(point.meets_guideline)

    def test_zero_income_has_no_share(self):
        point = inflation.affordability_point(2021, Decimal(1000), Decimal(0))
        self.assertIsNone(point.share_of_income_percent)
        self.assertIsNone(point.meets_guideline)

    def test_parses_and_sorts_points(self):
        triples = inflation.parse_affordability_points("2021:1300:72000,2011:1000:60000")
        self.assertEqual([t[0] for t in triples], [2011, 2021])

    def test_rejects_badly_formed_points(self):
        for raw in [None, "", "2011:1000", "2011:1000:60000:1"]:
            with self.subTest(raw=raw):
                with self.assertRaises(InvalidInflationRequest):
                    inflation.parse_affordability_points(raw)

    def test_needs_at_least_two_years(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "at least two years"):
            inflation.parse_affordability_points("2011:1000:60000")

    def test_rejects_a_repeated_year(self):
        with self.assertRaisesMessage(InvalidInflationRequest, "appears more than once"):
            inflation.parse_affordability_points("2011:1000:60000,2011:1100:61000")

    def test_rejects_more_than_fifty_points(self):
        raw = ",".join(f"{1950 + i}:100:1000" for i in range(51))
        with self.assertRaisesMessage(InvalidInflationRequest, "at most 50"):
            inflation.parse_affordability_points(raw)

    def test_rent_taking_a_larger_share_of_income(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(60000)), (2021, Decimal(1300), Decimal(72000))], self.table)
        self.assertEqual(trend["share_change_points"], "1.67")
        self.assertTrue(trend["rent_outpaced_income"])
        self.assertEqual(trend["rent_change"]["real_change_percent"], "8.33")
        self.assertEqual(trend["income_change"]["real_change_percent"], "0.00")
        self.assertEqual(trend["summary"],
                         "Rent took a larger share of income in 2021 than in 2011 (up 1.7 percentage points).")

    def test_rent_taking_a_smaller_share_of_income(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(60000)), (2021, Decimal(1100), Decimal(80000))], self.table)
        self.assertFalse(trend["rent_outpaced_income"])
        self.assertIn("smaller share", trend["summary"])

    def test_rent_taking_the_same_share_of_income(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(60000)), (2021, Decimal(1200), Decimal(72000))], self.table)
        self.assertEqual(trend["share_change_points"], "0.00")
        self.assertEqual(trend["summary"], "Rent took the same share of income in 2011 and 2021.")

    def test_a_zero_income_cannot_be_compared(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(0)), (2021, Decimal(1200), Decimal(72000))], self.table)
        self.assertIsNone(trend["share_change_points"])
        self.assertIn("cannot be compared", trend["summary"])

    def test_lists_every_point_and_the_guideline(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(60000)), (2016, Decimal(1100), Decimal(66000)),
             (2021, Decimal(1300), Decimal(72000))], self.table)
        self.assertEqual([p["year"] for p in trend["points"]], [2011, 2016, 2021])
        self.assertEqual(trend["guideline_percent"], "30")
        self.assertEqual(trend["first_year"], 2011)
        self.assertEqual(trend["last_year"], 2021)

    def test_a_year_without_cpi_keeps_the_share_but_not_the_real_change(self):
        trend = inflation.affordability_trend(
            [(2011, Decimal(1000), Decimal(60000)), (2026, Decimal(1500), Decimal(80000))], self.table)
        self.assertIsNotNone(trend["share_change_points"])
        self.assertIsNone(trend["rent_change"]["real_change_percent"])


# --------------------------------------------------------------------------- deeper endpoints

class DeeperEndpointTests(CpiDatabaseMixin, TestCase):
    """The convert-month, latest, series, rates, census-adjust and affordability-trend endpoints."""

    def add_2025(self):
        create_cpi_rows(self.source, months_for(2025, [125] * 12))

    def test_convert_month(self):
        data = self.client.get("/api/cpi/convert-month/",
                               {"amount": "1000", "from_period": "2011-05", "to_period": "2021-05"}).json()
        self.assertEqual(data["adjusted_value"], "1200.00")
        self.assertEqual(data["from_period"], "2011-05")
        self.assertEqual(data["to_period"], "2021-05")

    def test_convert_month_rejects_bad_periods(self):
        response = self.client.get("/api/cpi/convert-month/",
                                   {"amount": "1000", "from_period": "May 2011", "to_period": "2021-05"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("from_period", response.json()["error"])

    def test_latest_without_recent_months_is_not_adjusted(self):
        data = self.client.get("/api/cpi/latest/", {"amount": "1000", "from_year": "2011"}).json()
        self.assertEqual(data["status"], "not_adjusted")
        self.assertIsNone(data["latest_twelve_months"])

    def test_latest_with_recent_months(self):
        self.add_2025()
        data = self.client.get("/api/cpi/latest/", {"amount": "1000", "from_year": "2011"}).json()
        self.assertEqual(data["adjusted_value"], "1287.50")
        self.assertEqual(data["latest_twelve_months"]["label"], "the 12 months from 2025-10 to 2026-09")
        self.assertIn("not a calendar-year CPI", data["note"])

    def test_annual_endpoint_reports_the_latest_months(self):
        self.add_2025()
        data = self.client.get("/api/cpi/annual/").json()
        self.assertEqual(data["latest_twelve_months"]["value"], "128.7500")

    def test_latest_rejects_bad_input(self):
        self.assertEqual(self.client.get("/api/cpi/latest/", {"amount": "x", "from_year": "2011"}).status_code, 400)

    def test_series(self):
        data = self.client.get("/api/cpi/series/", {"values": "2011:1000,2016:1100,2026:1500", "to_year": "2021"}).json()
        self.assertEqual([v["adjusted_value"] for v in data["values"]], ["1200.00", "1200.00", None])
        self.assertEqual(data["adjusted_count"], 2)
        self.assertEqual(data["not_adjusted_count"], 1)

    def test_series_rejects_bad_input(self):
        self.assertEqual(self.client.get("/api/cpi/series/", {"values": "2011", "to_year": "2021"}).status_code, 400)
        self.assertEqual(self.client.get("/api/cpi/series/", {"values": "2011:1000"}).status_code, 400)

    def test_rates_lists_year_over_year(self):
        data = self.client.get("/api/cpi/rates/").json()
        self.assertEqual([row["year"] for row in data["year_over_year"]], [2011, 2016, 2021])
        self.assertNotIn("between", data)
        self.assertNotIn("rebased", data)

    def test_rates_between_two_years(self):
        data = self.client.get("/api/cpi/rates/", {"from_year": "2011", "to_year": "2021"}).json()
        self.assertEqual(data["between"]["total_inflation_percent"], "20.00")
        self.assertEqual(data["between"]["average_yearly_inflation_percent"], "1.84")
        self.assertIsNone(data["between"]["reason"])

    def test_rates_between_years_explains_a_missing_year(self):
        data = self.client.get("/api/cpi/rates/", {"from_year": "2011", "to_year": "2026"}).json()
        self.assertIsNone(data["between"]["average_yearly_inflation_percent"])
        self.assertIn("9 of 12 months", data["between"]["reason"])
        data = self.client.get("/api/cpi/rates/", {"from_year": "2015", "to_year": "2021"}).json()
        self.assertIn("11 of 12 months", data["between"]["reason"])

    def test_rates_rebased(self):
        data = self.client.get("/api/cpi/rates/", {"base_year": "2011"}).json()
        self.assertEqual(data["rebased"]["index"][-1], {"year": 2021, "value": "120.00"})

    def test_rates_rejects_half_a_range_and_bad_bases(self):
        self.assertEqual(self.client.get("/api/cpi/rates/", {"from_year": "2011"}).status_code, 400)
        self.assertEqual(self.client.get("/api/cpi/rates/", {"base_year": "2026"}).status_code, 400)
        self.assertEqual(self.client.get("/api/cpi/rates/", {"base_year": "soon"}).status_code, 400)

    def test_census_adjust(self):
        data = self.client.get("/api/cpi/census-adjust/",
                               {"amount": "1100", "census_year": "2017", "measure": "income", "to_year": "2021"}).json()
        self.assertEqual(data["reference_year"], 2016)
        self.assertEqual(data["adjusted_value"], "1200.00")
        self.assertEqual(data["measure"], "income")

    def test_census_adjust_rejects_unknown_measures(self):
        response = self.client.get("/api/cpi/census-adjust/",
                                   {"amount": "1", "census_year": "2021", "measure": "height", "to_year": "2021"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unknown Census measure", response.json()["error"])

    def test_affordability_trend(self):
        data = self.client.get("/api/cpi/affordability-trend/", {"points": "2011:1000:60000,2021:1300:72000"}).json()
        self.assertTrue(data["rent_outpaced_income"])
        self.assertEqual(data["share_change_points"], "1.67")
        self.assertEqual(data["source"]["id"], "cpi-test")

    def test_affordability_trend_rejects_bad_points(self):
        self.assertEqual(self.client.get("/api/cpi/affordability-trend/", {"points": "2011:1000:60000"}).status_code, 400)


class DeeperEndpointsWithoutCpiTests(TestCase):
    """Every new endpoint answers 503 when CPI is not loaded."""

    def test_each_endpoint_answers_503(self):
        for url, params in [
            ("/api/cpi/convert-month/", {"amount": "1", "from_period": "2011-01", "to_period": "2021-01"}),
            ("/api/cpi/latest/", {"amount": "1", "from_year": "2011"}),
            ("/api/cpi/series/", {"values": "2011:1", "to_year": "2021"}),
            ("/api/cpi/rates/", {}),
            ("/api/cpi/census-adjust/", {"amount": "1", "census_year": "2021", "measure": "rent", "to_year": "2021"}),
            ("/api/cpi/affordability-trend/", {"points": "2011:1:1,2021:1:1"}),
        ]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, params).status_code, 503)


class CpiInventoryDeeperTests(CpiDatabaseMixin, TestCase):
    """cpi_inventory's year-over-year column, latest months and --base-year."""

    def run_command(self, *args):
        out = StringIO()
        call_command("cpi_inventory", *args, stdout=out)
        return out.getvalue()

    def test_shows_a_change_column(self):
        self.assertIn("Change", self.run_command())

    def test_shows_when_the_latest_months_are_not_available(self):
        self.assertIn("Latest 12 months: not available", self.run_command())

    def test_shows_the_latest_months(self):
        create_cpi_rows(self.source, months_for(2025, [125] * 12))
        output = self.run_command()
        self.assertIn("Latest 12 months: 2025-10 to 2026-09, average 128.75", output)

    def test_shows_a_rebased_index(self):
        output = self.run_command("--base-year", "2011")
        self.assertIn("CPI with 2011 = 100", output)
        self.assertIn("120.00", output)

    def test_rejects_a_base_year_without_cpi(self):
        with self.assertRaisesMessage(CommandError, "cannot be the base year"):
            self.run_command("--base-year", "2026")
