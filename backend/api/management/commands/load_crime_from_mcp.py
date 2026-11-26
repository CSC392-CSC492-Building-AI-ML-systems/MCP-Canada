"""Load Toronto Police neighbourhood crime rates from MCP-Canada, next to the CSV rows.

Asks MCP-Canada's toronto_get_neighbourhood_crime_rates for every year from 2014
to 2025 (one call per year, all 158 neighbourhoods and all nine offences) and
saves the counts, rates and TPS population estimate as Observations under a
separate source, "mcp-canada-crime-rates". It reuses the tps-crime-* indicators
the CSV import created. The CSV observations are never touched, so the pages
keep working while the two are compared with compare_crime_sources.

Run it again to refresh: the MCP-Canada rows are replaced as a whole.

    uv run python manage.py load_crime_from_mcp --dry-run
    uv run python manage.py load_crime_from_mcp
"""
import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.management.commands.load_census_from_mcp import name_key
from api.mcp_canada_cache import fetch_from_mcp_canada
from api.models import Geography, Indicator, Observation, SourceRelease

TOOL = "toronto_get_neighbourhood_crime_rates"
SOURCE_ID = "mcp-canada-crime-rates"
GEOGRAPHY_SET = "toronto-158"
YEARS = tuple(range(2014, 2026))
# MCP-Canada crime_type -> the offence key in the app's indicator ids (tps-crime-<key>-count/-rate).
OFFENCES = {
    "assault": "assault",
    "auto_theft": "autotheft",
    "bike_theft": "biketheft",
    "break_and_enter": "breakenter",
    "homicide": "homicide",
    "robbery": "robbery",
    "shooting": "shooting",
    "theft_from_vehicle": "theftfrommv",
    "theft_over": "theftover",
}
POPULATION_INDICATOR = "tps-crime-population"
POPULATION_YEAR = 2025  # MCP-Canada (and the TPS layer) only publish the 2025 estimate.
MAX_AGE = timedelta(days=30)


def value_and_status(raw):
    """A count or rate from MCP-Canada: a number is observed, None is missing."""
    if raw is None:
        return None, "missing"
    value = Decimal(str(raw))
    if not value.is_finite():
        raise ValueError(f"Non-finite value {raw!r}")
    return value, "observed"


class Command(BaseCommand):
    help = "Load Toronto Police crime rates from MCP-Canada as a separate source next to the CSV rows."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, action="append", choices=YEARS,
                            help="Year to load; repeat for several (default: 2014-2025).")
        parser.add_argument("--refresh", action="store_true",
                            help="Call MCP-Canada even when a saved copy is younger than 30 days.")
        parser.add_argument("--dry-run", action="store_true",
                            help="Fetch and check everything, then save nothing.")

    def handle(self, *args, **options):
        indicator_ids = [f"tps-crime-{key}-{measure}" for key in OFFENCES.values()
                         for measure in ("count", "rate")] + [POPULATION_INDICATOR]
        indicators = Indicator.objects.in_bulk(indicator_ids)
        missing = sorted(set(indicator_ids) - set(indicators))
        if missing:
            raise CommandError(f"Indicators not in the DB: {missing}. Run the CSV import first.")
        geographies = {g.code: g for g in Geography.objects.filter(geography_set_id=GEOGRAPHY_SET)}
        if not geographies:
            raise CommandError(f"No {GEOGRAPHY_SET} neighbourhoods in the DB. Run the CSV import first.")

        years = sorted(options["year"] or YEARS)
        observations, payloads, timestamps, populations = [], [], [], {}
        for year in years:
            result = fetch_from_mcp_canada(TOOL, {"year": year}, max_age=MAX_AGE,
                                           refresh=options["refresh"])
            if result["status"] == "unavailable":
                raise CommandError(f"{year}: MCP-Canada unavailable ({result['error']})")
            if result["status"] == "may_be_outdated":
                self.stdout.write(self.style.WARNING(
                    f"{year}: live call failed, using saved copy ({result['error']})"))
            rows = (result["data"] or {}).get("neighbourhoods", [])
            self.check_neighbourhoods(year, rows, geographies)

            locator = f"mcp-canada:{TOOL}?year={year}"
            for row in rows:
                geography = geographies[row["neighbourhood_number"]]
                crimes = row.get("crimes", {})
                for crime_type, key in OFFENCES.items():
                    figures = crimes.get(crime_type, {}).get(str(year), {})
                    for measure, raw in (("count", figures.get("count")),
                                         ("rate", figures.get("rate_per_100k"))):
                        value, status = value_and_status(raw)
                        observations.append(Observation(
                            source_id=SOURCE_ID, geography=geography,
                            indicator=indicators[f"tps-crime-{key}-{measure}"],
                            reference_year=year, period="annual", value=value, status=status,
                            source_locator=f"{locator}&crime_type={crime_type}&field={measure}",
                            notes="From MCP-Canada (Toronto Police Service Neighbourhood Crime Rates)."))
                populations[geography.code] = row.get("population_2025")
            payloads.append(rows)
            if result["source"].get("reported_at"):
                timestamps.append(parse_datetime(result["source"]["reported_at"]))

        # The population estimate is the same in every year's answer; save it once.
        for code, raw in populations.items():
            value, status = value_and_status(raw)
            observations.append(Observation(
                source_id=SOURCE_ID, geography=geographies[code],
                indicator=indicators[POPULATION_INDICATOR], reference_year=POPULATION_YEAR,
                period="annual", value=value, status=status,
                source_locator=f"mcp-canada:{TOOL}&field=population_2025",
                notes="From MCP-Canada (Toronto Police Service population estimate; not a Census count)."))

        digest = hashlib.sha256(json.dumps(payloads, sort_keys=True, default=str).encode()).hexdigest()
        with transaction.atomic():
            SourceRelease.objects.update_or_create(id=SOURCE_ID, defaults=dict(
                publisher="Toronto Police Service, via MCP-Canada",
                title="Neighbourhood Crime Rates (MCP-Canada)",
                url="https://data.torontopolice.on.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data/about",
                licence="Open Government Licence – Ontario",
                retrieved_at=max(timestamps) if timestamps else timezone.now(),
                sha256=digest,
                coverage=f"Reported crime by Toronto 158-model neighbourhood, {years[0]}–{years[-1]}; "
                         "excludes incidents without a verified location",
                notes=f"Loaded with MCP-Canada {TOOL}. Same indicators as the crime-rates CSV import. "
                      "Rates are per 100,000 using TPS population estimates and are rounded to 1 decimal."))
            Observation.objects.filter(source_id=SOURCE_ID).delete()
            Observation.objects.bulk_create(observations, batch_size=500)
            if options["dry_run"]:
                transaction.set_rollback(True)

        self.stdout.write(self.style.SUCCESS(
            f"{years[0]}–{years[-1]}: {len(rows) if years else 0} neighbourhoods, "
            f"{len(observations)} observations "
            + ("checked (dry run, nothing saved)" if options["dry_run"] else f"saved as {SOURCE_ID}")))

    def check_neighbourhoods(self, year, rows, geographies):
        """Every MCP-Canada row must be one of the 158 boundaries, with the same name, once."""
        numbers = [row.get("neighbourhood_number") for row in rows]
        if len(set(numbers)) != len(numbers) or set(numbers) != set(geographies):
            unknown = sorted(set(numbers) - set(geographies), key=str)
            absent = sorted(set(geographies) - set(numbers), key=str)
            raise CommandError(
                f"{year}: MCP-Canada neighbourhoods don't match the {GEOGRAPHY_SET} boundaries "
                f"({len(numbers)} rows vs {len(geographies)} boundaries; "
                f"unknown: {unknown[:10]}, missing: {absent[:10]})")
        for row in rows:
            boundary = geographies[row["neighbourhood_number"]]
            if name_key(row.get("neighbourhood")) != name_key(boundary.name):
                raise CommandError(
                    f"{year}: neighbourhood {boundary.code} is {row.get('neighbourhood')!r} in "
                    f"MCP-Canada but {boundary.name!r} in the boundaries")
