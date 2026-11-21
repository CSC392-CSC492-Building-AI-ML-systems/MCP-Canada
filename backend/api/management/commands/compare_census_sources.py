"""Check MCP-Canada census rows against the CSV rows, value by value.

For each census year, every (neighbourhood, indicator) in the CSV source must
have the same value and status in mcp-canada-census-<year>, and the other way
round. Run it after load_census_from_mcp, before pointing the explorer at the
MCP-Canada rows.

    uv run python manage.py compare_census_sources --year 2016
"""
from django.core.management.base import BaseCommand, CommandError

from api.models import Observation, SourceRelease

YEARS = (2006, 2011, 2016, 2021)


def rows_for(source_id, year):
    return {(o["geography_id"], o["indicator_id"]): (o["value"], o["status"], o["reference_year"])
            for o in Observation.objects.filter(source_id=source_id, census_year=year)
            .values("geography_id", "indicator_id", "value", "status", "reference_year")}


class Command(BaseCommand):
    help = "Compare census observations from MCP-Canada with the ones from the CSV import."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, action="append", choices=YEARS,
                            help="Census year to check; repeat for several (default: all).")
        parser.add_argument("--show", type=int, default=10, help="How many differences to print per year.")

    def handle(self, *args, **options):
        failed = []
        for year in options["year"] or YEARS:
            csv_source = SourceRelease.objects.filter(id__startswith=f"census-{year}-").first()
            mcp_source = f"mcp-canada-census-{year}"
            if csv_source is None:
                raise CommandError(f"{year}: no CSV source in the DB")
            if not Observation.objects.filter(source_id=mcp_source).exists():
                raise CommandError(f"{year}: no {mcp_source} rows. Run load_census_from_mcp --year {year} first.")

            csv_rows, mcp_rows = rows_for(csv_source.id, year), rows_for(mcp_source, year)
            only_csv = sorted(set(csv_rows) - set(mcp_rows))
            only_mcp = sorted(set(mcp_rows) - set(csv_rows))
            different = sorted(k for k in set(csv_rows) & set(mcp_rows) if csv_rows[k] != mcp_rows[k])

            same = len(csv_rows) - len(only_csv) - len(different)
            summary = (f"{year}: {same}/{len(csv_rows)} match; {len(different)} different, "
                       f"{len(only_csv)} only in CSV, {len(only_mcp)} only in MCP-Canada")
            if not (only_csv or only_mcp or different):
                self.stdout.write(self.style.SUCCESS(summary))
                continue
            failed.append(year)
            self.stdout.write(self.style.ERROR(summary))
            for key in different[:options["show"]]:
                self.stdout.write(f"  different {key}: CSV {csv_rows[key]}  MCP-Canada {mcp_rows[key]}")
            for key in only_csv[:options["show"]]:
                self.stdout.write(f"  only in CSV {key}: {csv_rows[key]}")
            for key in only_mcp[:options["show"]]:
                self.stdout.write(f"  only in MCP-Canada {key}: {mcp_rows[key]}")
        if failed:
            raise CommandError(f"Differences in {', '.join(map(str, failed))}. Don't switch those years yet.")
