"""Print the annual CPI table that inflation adjustment uses.

Usage, from backend/:

    uv run python manage.py cpi_inventory
    uv run python manage.py cpi_inventory --start-year 2011 --end-year 2021
    uv run python manage.py cpi_inventory --convert 1000 --from-year 2011 --to-year 2021
    uv run python manage.py cpi_inventory --base-year 2021

The table shows, for every year in the loaded CPI series, how many months were
published, whether the year is complete, and its annual average. With
--convert it also shows one conversion, worked out the same way as the API.
"""
from django.core.management.base import BaseCommand, CommandError

from api import inflation


class Command(BaseCommand):
    help = "Show the annual CPI used for inflation adjustment, and optionally convert one amount."

    def add_arguments(self, parser):
        parser.add_argument("--start-year", help="First year to show (inclusive).")
        parser.add_argument("--end-year", help="Last year to show (inclusive).")
        parser.add_argument("--convert", help="An amount to convert, such as 1000.")
        parser.add_argument("--from-year", help="The year the amount is from.")
        parser.add_argument("--to-year", help="The year to convert the amount into.")
        parser.add_argument("--base-year", help="Also show every year's CPI with this year = 100.")

    def handle(self, *args, **options):
        start_year = self._optional_year(options.get("start_year"), "start-year")
        end_year = self._optional_year(options.get("end_year"), "end-year")
        if start_year is not None and end_year is not None and start_year > end_year:
            raise CommandError("--start-year must not be after --end-year.")

        try:
            table = inflation.load_cpi_table()
        except inflation.InflationDataUnavailable as exc:
            raise CommandError(str(exc)) from exc

        self._print_source(table)
        self._print_table(table, start_year, end_year)
        self._print_summary(table)
        self._print_latest(table)

        base_year = self._optional_year(options.get("base_year"), "base-year")
        if base_year is not None:
            self._print_rebased(table, base_year, start_year, end_year)

        if options.get("convert") is not None:
            self._print_conversion(table, options)

    # ------------------------------------------------------------------ helpers

    def _optional_year(self, raw, name):
        """Parse an optional year option, turning input errors into CommandError."""
        if raw is None:
            return None
        try:
            return inflation.parse_year(raw, name)
        except inflation.InvalidInflationRequest as exc:
            raise CommandError(str(exc)) from exc

    def _print_source(self, table):
        """Name the source release the CPI came from."""
        source = table.source
        if source is None:
            self.stdout.write("Source: unknown")
            return
        self.stdout.write(f"Source: {source.title} ({source.publisher})")
        self.stdout.write(f"Release: {source.id}")
        if source.retrieved_at:
            self.stdout.write(f"Retrieved: {source.retrieved_at}")
        self.stdout.write(f"URL: {source.url}")
        self.stdout.write("")

    def _print_table(self, table, start_year, end_year):
        """One line per year: months published, status and annual average."""
        header = f"{'Year':<6}{'Months':>8}  {'Status':<11}{'Annual CPI':>12}{'Change':>10}"
        yearly_changes = {row["year"]: row["inflation_percent"] for row in inflation.year_over_year(table)}
        self.stdout.write(header)
        self.stdout.write("-" * len(header))
        for year in sorted(table.years):
            if start_year is not None and year < start_year:
                continue
            if end_year is not None and year > end_year:
                continue
            entry = table.years[year]
            value = inflation.decimal_to_string(entry.value, places=2) or "—"
            change = yearly_changes.get(year)
            change_text = f"{change}%" if change is not None else "—"
            self.stdout.write(
                f"{year:<6}{entry.months_counted:>8}  {entry.status:<11}{value:>12}{change_text:>10}"
            )
        self.stdout.write("")

    def _print_summary(self, table):
        """The range of complete years, and which years are incomplete."""
        complete = table.complete_years()
        incomplete = sorted(year for year, entry in table.years.items() if not entry.is_complete)
        if complete:
            self.stdout.write(f"Complete years: {complete[0]}–{complete[-1]} ({len(complete)} years)")
        else:
            self.stdout.write("Complete years: none")
        if incomplete:
            listed = ", ".join(str(year) for year in incomplete)
            self.stdout.write(f"Incomplete years (no annual value): {listed}")
        self.stdout.write("")

    def _print_conversion(self, table, options):
        """Convert one amount, exactly as the /api/cpi/convert/ endpoint would."""
        try:
            amount = inflation.parse_amount(options.get("convert"), "convert")
            from_year = inflation.parse_year(options.get("from_year"), "from-year")
            to_year = inflation.parse_year(options.get("to_year"), "to-year")
        except inflation.InvalidInflationRequest as exc:
            raise CommandError(str(exc)) from exc

        result = inflation.adjust_amount(amount, from_year, to_year, table)
        original = inflation.decimal_to_string(result.original_value, places=2)
        if result.was_adjusted:
            adjusted = inflation.decimal_to_string(result.adjusted_value, places=2)
            factor = inflation.decimal_to_string(result.factor, places=6)
            self.stdout.write(
                f"${original} in {from_year} dollars is ${adjusted} in {to_year} dollars (factor {factor})."
            )
        else:
            self.stdout.write(f"${original} from {from_year} was not adjusted: {result.reason}")

    def _print_latest(self, table):
        """The latest twelve consecutive months, for near-current dollars."""
        trailing = inflation.latest_trailing_cpi(table)
        if trailing is None:
            self.stdout.write("Latest 12 months: not available (no twelve consecutive recent months)")
        else:
            value = inflation.decimal_to_string(trailing.value, places=2)
            self.stdout.write(f"Latest 12 months: {trailing.first_period} to {trailing.last_period}, average {value}")
        self.stdout.write("")

    def _print_rebased(self, table, base_year, start_year, end_year):
        """Every complete year's CPI with base_year = 100."""
        try:
            rebased = inflation.rebase(table, base_year)
        except inflation.InvalidInflationRequest as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"CPI with {base_year} = 100")
        for year in sorted(rebased):
            if start_year is not None and year < start_year:
                continue
            if end_year is not None and year > end_year:
                continue
            self.stdout.write(f"{year:<6}{inflation.decimal_to_string(rebased[year], places=2):>10}")
        self.stdout.write("")
