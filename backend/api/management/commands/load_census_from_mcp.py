"""Load the census indicators the app already uses from MCP-Canada, next to the CSV rows.

For each census year this reads the indicators that the CSV import created
(census-<year>-row-<n>), asks MCP-Canada's toronto_compare_neighbourhoods for
the same characteristic across all neighbourhoods, and saves the values as
Observations under a separate source, "mcp-canada-census-<year>". The CSV
observations are never touched, so the explorer keeps working while the two
are compared.

Run it again to refresh: that year's MCP-Canada rows are replaced as a whole.

    uv run python manage.py load_census_from_mcp --year 2016 --dry-run
    uv run python manage.py load_census_from_mcp --year 2016
"""
import hashlib
import json
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.mcp_canada_cache import fetch_from_mcp_canada
from api.models import Geography, Indicator, Observation, SourceRelease, SourceTableRow

TOOL = "toronto_compare_neighbourhoods"
YEARS = (2001, 2006, 2011, 2016, 2021)
GEOGRAPHY_SET = {2001: "toronto-140", 2006: "toronto-140", 2011: "toronto-140", 2016: "toronto-140", 2021: "toronto-158"}
# Keys in each MCP-Canada row that are not neighbourhood columns.
META_KEYS = {"year", "_id", "Category", "Topic", "Data Source", "Characteristic", "City of Toronto"}
MAX_AGE = timedelta(days=30)


def name_key(name):
    """Same neighbourhood-name matching as scripts/prepare_official_data.py."""
    return re.sub("[^a-z0-9]", "", re.sub(r"\s*\(\d+\)$", "", str(name)).lower())


def label_key(text):
    return " ".join(str(text or "").split()).lower()


def number(raw):
    """Same value rules as scripts/prepare_official_data.py: returns (value, status)."""
    if raw is None or str(raw).strip() == "":
        return None, "missing"
    token = str(raw).strip()
    if token in ("x", "X", "**", "F"):
        return None, "suppressed"
    if token in ("...", "…"):
        return None, "not_applicable"
    if token in ("..", "-", "n/a", "N/A"):
        return None, "missing"
    try:
        value = Decimal(token.replace(",", "").replace("%", "").replace("$", ""))
    except InvalidOperation:
        raise ValueError(f"Unrecognized numeric token: {raw!r}")
    if not value.is_finite():
        raise ValueError("Non-finite source measurement")
    return value, "observed"


def pick_row(indicator, rows, year):
    """Find the one MCP-Canada row that is this indicator, or explain why not."""
    matches = [r for r in rows if label_key(r.get("Characteristic")) == label_key(indicator.label)]
    if len(matches) > 1:
        # Repeated labels: keep the row whose Topic/Category matches the CSV row's context.
        if year == 2021:
            context = {label_key(indicator.universe)}
        else:
            context = {label_key(c) for c in indicator.dimensions.get("source_columns", [])}
        narrowed = [r for r in matches
                    if label_key(r.get("Topic")) in context
                    and (year == 2021 or label_key(r.get("Category")) in context)]
        if len(narrowed) == 1:
            return narrowed[0], None
        matches = narrowed or matches
    if len(matches) > 1:
        # Same label and topic (e.g. 2006 "Median household income $" appears twice): use the
        # order of the rows in the source table. MCP-Canada returns rows in that same order;
        # compare_census_sources checks every value afterwards.
        same_label = sorted(
            int(row.locator.rsplit("/", 1)[1])
            for row in SourceTableRow.objects.filter(source__id__startswith=f"census-{year}-",
                                                     locator__regex=r"/[0-9]+$")
            if label_key(row.label) == label_key(indicator.label))
        row_number = indicator.dimensions.get("row")
        if len(same_label) == len(matches) and row_number in same_label:
            return matches[same_label.index(row_number)], None
        return None, (f"{len(matches)} MCP-Canada rows match the label, but the source table "
                      f"has {len(same_label)} rows with it")
    if len(matches) == 1:
        return matches[0], None
    return None, f"{len(matches)} MCP-Canada rows match the label"


class Command(BaseCommand):
    help = "Load census indicators from MCP-Canada as a separate source next to the CSV rows."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, action="append", choices=YEARS,
                            help="Census year to load; repeat for several (default: all).")
        parser.add_argument("--refresh", action="store_true",
                            help="Call MCP-Canada even when a saved copy is younger than 30 days.")
        parser.add_argument("--dry-run", action="store_true",
                            help="Fetch and check everything, then save nothing.")

    def handle(self, *args, **options):
        problems = []
        for year in options["year"] or YEARS:
            problems += self.load_year(year, options["refresh"], options["dry_run"])
        if problems:
            self.stdout.write(self.style.WARNING(f"{len(problems)} indicator(s) skipped:"))
            for problem in problems:
                self.stdout.write(f"  {problem}")

    def load_year(self, year, refresh, dry_run):
        indicators = list(Indicator.objects.filter(id__startswith=f"census-{year}-row-").order_by("id"))
        if not indicators:
            raise CommandError(f"No census-{year} indicators in the DB. Run the CSV import first.")
        geographies = {name_key(g.name): g.id for g in
                       Geography.objects.filter(geography_set_id=GEOGRAPHY_SET[year])}

        observations, problems, payloads, timestamps, skipped = [], [], [], [], set()
        source_id = f"mcp-canada-census-{year}"
        for indicator in indicators:
            arguments = {"characteristic": indicator.label, "year": year, "limit": 500}
            result = fetch_from_mcp_canada(TOOL, arguments, max_age=MAX_AGE, refresh=refresh)
            if result["status"] == "unavailable":
                problems.append(f"{indicator.id}: MCP-Canada unavailable ({result['error']})")
                skipped.add(indicator.id)
                continue
            if result["status"] == "may_be_outdated":
                self.stdout.write(self.style.WARNING(
                    f"{indicator.id}: live call failed, using saved copy ({result['error']})"))
            row, reason = pick_row(indicator, result["data"] or [], year)
            if row is None:
                problems.append(f"{indicator.id} ({indicator.label!r}): {reason}")
                skipped.add(indicator.id)
                continue

            names = [k for k in row if k not in META_KEYS]
            unknown = [n for n in names if name_key(n) not in geographies]
            if unknown or len(names) != len(geographies):
                raise CommandError(
                    f"{year}: MCP-Canada neighbourhood names don't match the {GEOGRAPHY_SET[year]} "
                    f"boundaries ({len(names)} columns vs {len(geographies)} boundaries; "
                    f"unmatched: {unknown[:10]})")

            # Keep the CSV's reference year (e.g. 2016 census incomes refer to 2015).
            reference_year = (Observation.objects.filter(indicator=indicator)
                              .exclude(source_id=source_id)
                              .values_list("reference_year", flat=True).first()) or year
            locator = f"mcp-canada:{TOOL}?year={year}&characteristic={indicator.label}"
            for name in names:
                try:
                    value, status = number(row[name])
                except ValueError as exc:
                    problems.append(f"{indicator.id} / {name}: {exc}")
                    continue
                observations.append(Observation(
                    source_id=source_id, geography_id=geographies[name_key(name)],
                    indicator=indicator, census_year=year, reference_year=reference_year,
                    period="annual", value=value, status=status, source_locator=locator,
                    notes="From MCP-Canada (City of Toronto Neighbourhood Profiles)."
                          + (f"; raw token={row[name]!r}" if status != "observed" else "")))
            payloads.append(row)
            if result["source"].get("reported_at"):
                timestamps.append(parse_datetime(result["source"]["reported_at"]))

        csv_source = SourceRelease.objects.filter(id__startswith=f"census-{year}-").first()
        digest = hashlib.sha256(json.dumps(payloads, sort_keys=True, default=str).encode()).hexdigest()
        with transaction.atomic():
            SourceRelease.objects.update_or_create(id=source_id, defaults=dict(
                publisher="City of Toronto / Statistics Canada, via MCP-Canada",
                title=f"{year} neighbourhood Census profile (MCP-Canada)",
                url="https://open.toronto.ca",
                licence=csv_source.licence if csv_source else "See City of Toronto Open Data licence",
                retrieved_at=max(timestamps) if timestamps else timezone.now(),
                sha256=digest,
                coverage=f"Toronto {158 if year == 2021 else 140} neighbourhood model",
                notes=f"Loaded with MCP-Canada {TOOL}. Same indicators as the census-{year} CSV "
                      "import, for side-by-side comparison. Monetary values are nominal."))
            Observation.objects.filter(source_id=source_id).delete()
            Observation.objects.bulk_create(observations, batch_size=500)
            if dry_run:
                transaction.set_rollback(True)

        done = len(indicators) - len(skipped)
        self.stdout.write(self.style.SUCCESS(
            f"{year}: {done}/{len(indicators)} indicators, {len(observations)} observations "
            + ("checked (dry run, nothing saved)" if dry_run else f"saved as {source_id}")))
        return problems
