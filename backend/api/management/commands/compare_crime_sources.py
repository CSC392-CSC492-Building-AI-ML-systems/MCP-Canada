"""Check MCP-Canada crime rows against the CSV rows, value by value.

Every (neighbourhood, indicator, year) in the crime-rates CSV source must have
the same status and value in mcp-canada-crime-rates, and the other way round.
Counts and the population estimate must match exactly. MCP-Canada rounds rates
to 1 decimal, so a rate matches when the CSV rate rounds to the same value.
Run it after load_crime_from_mcp, before pointing the pages at the MCP-Canada rows.

    uv run python manage.py compare_crime_sources
"""
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

from django.core.management.base import BaseCommand, CommandError

from api.management.commands.load_crime_from_mcp import SOURCE_ID
from api.models import Observation, SourceRelease

ONE_DECIMAL = Decimal("0.1")


def rows_for(source_id):
    return {(o["geography_id"], o["indicator_id"], o["reference_year"]): (o["value"], o["status"])
            for o in Observation.objects.filter(source_id=source_id)
            .values("geography_id", "indicator_id", "reference_year", "value", "status")}


def same(indicator_id, csv_cell, mcp_cell):
    (csv_value, csv_status), (mcp_value, mcp_status) = csv_cell, mcp_cell
    if csv_status != mcp_status:
        return False
    if csv_value is None or mcp_value is None:
        return csv_value == mcp_value
    if indicator_id.endswith("-rate"):
        # Python's round() (used by MCP-Canada) rounds a float, so accept either way of breaking a tie.
        return mcp_value in {csv_value.quantize(ONE_DECIMAL, rounding=r) for r in (ROUND_HALF_UP, ROUND_HALF_EVEN)}
    return csv_value == mcp_value


class Command(BaseCommand):
    help = "Compare crime observations from MCP-Canada with the ones from the CSV import."

    def add_arguments(self, parser):
        parser.add_argument("--show", type=int, default=10, help="How many differences to print.")

    def handle(self, *args, **options):
        csv_source = SourceRelease.objects.filter(id__startswith="crime-rates-").first()
        if csv_source is None:
            raise CommandError("No crime-rates CSV source in the DB")
        if not Observation.objects.filter(source_id=SOURCE_ID).exists():
            raise CommandError(f"No {SOURCE_ID} rows. Run load_crime_from_mcp first.")

        csv_rows, mcp_rows = rows_for(csv_source.id), rows_for(SOURCE_ID)
        only_csv = sorted(set(csv_rows) - set(mcp_rows))
        only_mcp = sorted(set(mcp_rows) - set(csv_rows))
        different = sorted(k for k in set(csv_rows) & set(mcp_rows)
                           if not same(k[1], csv_rows[k], mcp_rows[k]))

        matched = len(csv_rows) - len(only_csv) - len(different)
        summary = (f"{matched}/{len(csv_rows)} match; {len(different)} different, "
                   f"{len(only_csv)} only in CSV, {len(only_mcp)} only in MCP-Canada")
        if not (only_csv or only_mcp or different):
            self.stdout.write(self.style.SUCCESS(summary))
            return
        self.stdout.write(self.style.ERROR(summary))
        for key in different[:options["show"]]:
            self.stdout.write(f"  different {key}: CSV {csv_rows[key]}  MCP-Canada {mcp_rows[key]}")
        for key in only_csv[:options["show"]]:
            self.stdout.write(f"  only in CSV {key}: {csv_rows[key]}")
        for key in only_mcp[:options["show"]]:
            self.stdout.write(f"  only in MCP-Canada {key}: {mcp_rows[key]}")
        raise CommandError("Differences found. Don't switch the pages to MCP-Canada crime data yet.")
