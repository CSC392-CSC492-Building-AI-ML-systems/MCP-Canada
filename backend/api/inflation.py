"""Inflation adjustment using the Consumer Price Index (CPI) already in the database.

What this module does
---------------------
Dollar amounts from different years cannot be compared directly, because prices
rise over time. This module converts a dollar amount from one year into the
dollars of another year, using Canada's all-items CPI:

    value in target year = value x (CPI in target year / CPI in original year)

It also works out how much prices rose between two years, and how much a value
changed once that general price rise is taken out (the "real" change).

Where the CPI comes from
------------------------
The monthly CPI series V41690973 (Bank of Canada / Statistics Canada), stored as
Observation rows for the indicator ``canada-cpi-v41690973`` on the national
geography ``canada-cpi``. Nothing is fetched from the internet here.

How one year's CPI is worked out
--------------------------------
A year's CPI is the average of its twelve monthly values, the way Statistics
Canada publishes annual CPI. A year that is missing any month (for example the
current year before December) has no annual value and is reported as
incomplete. It is never estimated from the months that do exist.

Limits (say these wherever adjusted values are shown)
-----------------------------------------------------
* The CPI is national and covers all items (food, transport, shelter and more).
  It shows whether something rose faster than prices in general. It is not a
  Toronto housing index.
* Nothing is adjusted when either year has no complete CPI. The result says
  "not adjusted" with the reason, never a guess.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from .models import Indicator, Observation, SourceRelease

# --------------------------------------------------------------------------- constants

#: The CPI indicator loaded by backend/scripts/prepare_official_data.py.
CPI_INDICATOR_ID = "canada-cpi-v41690973"

#: The national geography the CPI observations are stored on.
CPI_GEOGRAPHY_ID = "canada-cpi"

#: How many monthly values a year needs before it has an annual CPI.
MONTHS_PER_YEAR = 12

#: Years outside this range are rejected as input errors, not looked up.
EARLIEST_ACCEPTED_YEAR = 1900
LATEST_ACCEPTED_YEAR = 2100

#: Status values used in results.
STATUS_ADJUSTED = "adjusted"
STATUS_SAME_YEAR = "same_year"
STATUS_NOT_ADJUSTED = "not_adjusted"

#: Status values used for each year in the annual table.
YEAR_COMPLETE = "complete"
YEAR_INCOMPLETE = "incomplete"


# --------------------------------------------------------------------------- errors

class InflationDataUnavailable(Exception):
    """The CPI series is not in the database, so nothing can be adjusted."""


class InvalidInflationRequest(ValueError):
    """An input (a year or an amount) could not be used. The message says why."""


# --------------------------------------------------------------------------- data shapes

@dataclass(frozen=True)
class MonthlyCpi:
    """One published monthly CPI value."""

    year: int
    month: int
    value: Decimal


@dataclass(frozen=True)
class AnnualCpi:
    """One year's CPI: the average of its months, or None when the year is incomplete."""

    year: int
    value: Decimal | None
    months_counted: int
    status: str

    @property
    def is_complete(self) -> bool:
        """True when all twelve months were published and the average exists."""
        return self.status == YEAR_COMPLETE and self.value is not None

    def as_dict(self) -> dict:
        """JSON-ready form. The value is a string so no precision is lost."""
        return {
            "year": self.year,
            "value": decimal_to_string(self.value, places=4),
            "months_counted": self.months_counted,
            "status": self.status,
        }


@dataclass(frozen=True)
class CpiSource:
    """Where the CPI came from, so every adjusted value can name its source."""

    id: str
    title: str
    publisher: str
    url: str
    retrieved_at: str | None

    def as_dict(self) -> dict:
        """JSON-ready form."""
        return {
            "id": self.id,
            "title": self.title,
            "publisher": self.publisher,
            "url": self.url,
            "retrieved_at": self.retrieved_at,
        }


@dataclass(frozen=True)
class AdjustmentResult:
    """The outcome of converting one amount from one year's dollars into another's."""

    original_value: Decimal
    from_year: int
    to_year: int
    status: str
    adjusted_value: Decimal | None = None
    factor: Decimal | None = None
    reason: str | None = None

    @property
    def was_adjusted(self) -> bool:
        """True when a converted value exists (including a same-year conversion)."""
        return self.status in (STATUS_ADJUSTED, STATUS_SAME_YEAR)

    def as_dict(self) -> dict:
        """JSON-ready form, with money rounded to cents and the factor to 6 places."""
        return {
            "original_value": decimal_to_string(self.original_value, places=2),
            "from_year": self.from_year,
            "to_year": self.to_year,
            "status": self.status,
            "adjusted_value": decimal_to_string(self.adjusted_value, places=2),
            "factor": decimal_to_string(self.factor, places=6),
            "reason": self.reason,
        }


@dataclass(frozen=True)
class RealChangeResult:
    """How much a value changed between two years, before and after inflation."""

    from_value: Decimal
    to_value: Decimal
    from_year: int
    to_year: int
    nominal_change_percent: Decimal | None
    real_change_percent: Decimal | None
    inflation_percent: Decimal | None
    from_value_in_to_year_dollars: Decimal | None
    status: str
    reason: str | None = None

    def as_dict(self) -> dict:
        """JSON-ready form, with percentages rounded to 2 places."""
        return {
            "from_value": decimal_to_string(self.from_value, places=2),
            "to_value": decimal_to_string(self.to_value, places=2),
            "from_year": self.from_year,
            "to_year": self.to_year,
            "nominal_change_percent": decimal_to_string(self.nominal_change_percent, places=2),
            "real_change_percent": decimal_to_string(self.real_change_percent, places=2),
            "inflation_percent": decimal_to_string(self.inflation_percent, places=2),
            "from_value_in_to_year_dollars": decimal_to_string(self.from_value_in_to_year_dollars, places=2),
            "status": self.status,
            "reason": self.reason,
        }


@dataclass
class CpiTable:
    """Every year's annual CPI, keyed by year, with the source it came from."""

    years: dict[int, AnnualCpi] = field(default_factory=dict)
    source: CpiSource | None = None

    def value_for(self, year: int) -> Decimal | None:
        """The year's annual CPI, or None when the year is incomplete or not covered."""
        entry = self.years.get(year)
        if entry is None:
            return None
        if not entry.is_complete:
            return None
        return entry.value

    def complete_years(self) -> list[int]:
        """Every year with a full twelve months, oldest first."""
        return sorted(year for year, entry in self.years.items() if entry.is_complete)

    def latest_complete_year(self) -> int | None:
        """The most recent year with a full twelve months, or None if there is none."""
        years = self.complete_years()
        if not years:
            return None
        return years[-1]

    def earliest_complete_year(self) -> int | None:
        """The oldest year with a full twelve months, or None if there is none."""
        years = self.complete_years()
        if not years:
            return None
        return years[0]

    def missing_reason(self, year: int) -> str:
        """A plain-language reason why the year has no annual CPI."""
        entry = self.years.get(year)
        if entry is None:
            return f"No CPI is published for {year} in the loaded data."
        if entry.months_counted < MONTHS_PER_YEAR:
            return (
                f"{year} has CPI for only {entry.months_counted} of {MONTHS_PER_YEAR} months, "
                f"so it has no annual average yet."
            )
        return f"No annual CPI is available for {year}."


# --------------------------------------------------------------------------- small helpers

def decimal_to_string(value: Decimal | None, places: int) -> str | None:
    """Round half up to the given number of decimal places and return it as text."""
    if value is None:
        return None
    quantum = Decimal(1).scaleb(-places)
    return str(value.quantize(quantum, rounding=ROUND_HALF_UP))


def parse_year(raw, name: str = "year") -> int:
    """Read a year from user input. Raises InvalidInflationRequest with a clear message."""
    if raw is None:
        raise InvalidInflationRequest(f"Missing {name}. Give a four-digit year, such as 2011.")
    text = str(raw).strip()
    if text == "":
        raise InvalidInflationRequest(f"Missing {name}. Give a four-digit year, such as 2011.")
    if not text.isdigit():
        raise InvalidInflationRequest(f"{name} must be a whole year, such as 2011, not {text!r}.")
    year = int(text)
    if year < EARLIEST_ACCEPTED_YEAR or year > LATEST_ACCEPTED_YEAR:
        raise InvalidInflationRequest(
            f"{name} must be between {EARLIEST_ACCEPTED_YEAR} and {LATEST_ACCEPTED_YEAR}, not {year}."
        )
    return year


def parse_amount(raw, name: str = "amount") -> Decimal:
    """Read a dollar amount from user input. Zero is allowed; negative or non-numbers are not."""
    if raw is None:
        raise InvalidInflationRequest(f"Missing {name}. Give a dollar amount, such as 1000.")
    text = str(raw).strip()
    if text == "":
        raise InvalidInflationRequest(f"Missing {name}. Give a dollar amount, such as 1000.")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        raise InvalidInflationRequest(f"{name} must be a number, such as 1000, not {text!r}.") from None
    if not amount.is_finite():
        raise InvalidInflationRequest(f"{name} must be a finite number.")
    if amount < 0:
        raise InvalidInflationRequest(f"{name} cannot be negative.")
    return amount


def parse_period(period: str) -> tuple[int, int] | None:
    """Split a 'YYYY-MM' period into (year, month). Any other form returns None."""
    if not isinstance(period, str):
        return None
    parts = period.split("-")
    if len(parts) != 2:
        return None
    year_text, month_text = parts
    if len(year_text) != 4 or not year_text.isdigit():
        return None
    if len(month_text) != 2 or not month_text.isdigit():
        return None
    year = int(year_text)
    month = int(month_text)
    if month < 1 or month > 12:
        return None
    return year, month


# --------------------------------------------------------------------------- loading the CPI

def cpi_source(source_id: str | None = None) -> CpiSource:
    """The one source release that holds the CPI observations.

    When several releases hold CPI (for example after a re-import), the most
    recently retrieved one is used, so a single consistent series is read.
    """
    source_ids = Observation.objects.filter(indicator_id=CPI_INDICATOR_ID)
    if source_id:
        source_ids = source_ids.filter(source_id=source_id)
    source_ids = list(source_ids.values_list("source_id", flat=True).distinct())
    if not source_ids:
        raise InflationDataUnavailable(
            "The CPI series is not loaded. Run backend/scripts/setup_official_data.py to import it."
        )
    releases = SourceRelease.objects.filter(id__in=source_ids).order_by("-retrieved_at", "id")
    release = releases.first()
    if release is None:
        raise InflationDataUnavailable("The CPI observations have no matching source release.")
    retrieved = release.retrieved_at.isoformat() if release.retrieved_at else None
    return CpiSource(
        id=release.id,
        title=release.title,
        publisher=release.publisher,
        url=release.url,
        retrieved_at=retrieved,
    )


def load_monthly_cpi(source_id: str | None = None) -> tuple[list[MonthlyCpi], CpiSource]:
    """Every observed monthly CPI value from one source, oldest first."""
    source = cpi_source(source_id)
    rows = Observation.objects.filter(
        indicator_id=CPI_INDICATOR_ID,
        geography_id=CPI_GEOGRAPHY_ID,
        source_id=source.id,
        status="observed",
        value__isnull=False,
    ).values_list("period", "value")
    months: list[MonthlyCpi] = []
    for period, value in rows:
        parsed = parse_period(period)
        if parsed is None:
            # Not a monthly row (for example an annual summary): it is not part of the series.
            continue
        year, month = parsed
        months.append(MonthlyCpi(year=year, month=month, value=Decimal(value)))
    months.sort(key=lambda m: (m.year, m.month))
    return months, source


def annual_cpi_from_months(months: list[MonthlyCpi]) -> dict[int, AnnualCpi]:
    """Average each year's months. A year missing any month has no annual value.

    If the same month appears twice, the first one is kept, so a duplicated row
    can never be counted twice in an average.
    """
    by_year: dict[int, dict[int, Decimal]] = {}
    for entry in months:
        year_months = by_year.setdefault(entry.year, {})
        if entry.month not in year_months:
            year_months[entry.month] = entry.value

    table: dict[int, AnnualCpi] = {}
    for year in sorted(by_year):
        values = by_year[year]
        months_counted = len(values)
        if months_counted == MONTHS_PER_YEAR:
            total = sum(values.values(), Decimal(0))
            average = total / Decimal(MONTHS_PER_YEAR)
            table[year] = AnnualCpi(
                year=year,
                value=average,
                months_counted=months_counted,
                status=YEAR_COMPLETE,
            )
        else:
            table[year] = AnnualCpi(
                year=year,
                value=None,
                months_counted=months_counted,
                status=YEAR_INCOMPLETE,
            )
    return table


def load_cpi_table(source_id: str | None = None) -> CpiTable:
    """The annual CPI table built from the database."""
    months, source = load_monthly_cpi(source_id)
    if not months:
        raise InflationDataUnavailable("The CPI source has no monthly observations.")
    return CpiTable(years=annual_cpi_from_months(months), source=source)


def cpi_indicator_label() -> str | None:
    """The CPI indicator's label, for showing alongside results."""
    indicator = Indicator.objects.filter(id=CPI_INDICATOR_ID).values_list("label", flat=True).first()
    return indicator


# --------------------------------------------------------------------------- calculations

def adjust_amount(amount: Decimal, from_year: int, to_year: int, table: CpiTable) -> AdjustmentResult:
    """Convert an amount in from_year dollars into to_year dollars.

    * Same year in and out: the amount comes back unchanged, factor 1.
    * Either year without a complete CPI: "not adjusted", with the reason.
    """
    if from_year == to_year:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_SAME_YEAR,
            adjusted_value=amount,
            factor=Decimal(1),
        )

    from_cpi = table.value_for(from_year)
    if from_cpi is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason=table.missing_reason(from_year),
        )

    to_cpi = table.value_for(to_year)
    if to_cpi is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason=table.missing_reason(to_year),
        )

    factor = to_cpi / from_cpi
    adjusted = amount * factor
    return AdjustmentResult(
        original_value=amount,
        from_year=from_year,
        to_year=to_year,
        status=STATUS_ADJUSTED,
        adjusted_value=adjusted,
        factor=factor,
    )


def inflation_between(from_year: int, to_year: int, table: CpiTable) -> Decimal | None:
    """How much prices rose (or fell, if negative) from one year to another, as a percent."""
    if from_year == to_year:
        return Decimal(0)
    from_cpi = table.value_for(from_year)
    to_cpi = table.value_for(to_year)
    if from_cpi is None or to_cpi is None:
        return None
    return (to_cpi / from_cpi - Decimal(1)) * Decimal(100)


def percent_change(old: Decimal, new: Decimal) -> Decimal | None:
    """Percent change from old to new. None when old is zero (there is no percent of zero)."""
    if old == 0:
        return None
    return (new - old) / old * Decimal(100)


def real_change(
    from_value: Decimal,
    to_value: Decimal,
    from_year: int,
    to_year: int,
    table: CpiTable,
) -> RealChangeResult:
    """Compare two values from different years before and after taking out inflation.

    The nominal change is always given. The real change is given only when both
    years have a complete CPI. Otherwise the result says why it is missing.
    """
    nominal = percent_change(from_value, to_value)
    conversion = adjust_amount(from_value, from_year, to_year, table)

    if not conversion.was_adjusted:
        return RealChangeResult(
            from_value=from_value,
            to_value=to_value,
            from_year=from_year,
            to_year=to_year,
            nominal_change_percent=nominal,
            real_change_percent=None,
            inflation_percent=None,
            from_value_in_to_year_dollars=None,
            status=STATUS_NOT_ADJUSTED,
            reason=conversion.reason,
        )

    adjusted_from = conversion.adjusted_value
    real = percent_change(adjusted_from, to_value)
    inflation = inflation_between(from_year, to_year, table)
    reason = None
    if real is None:
        reason = "The starting value is $0, so there is no percent change."
    return RealChangeResult(
        from_value=from_value,
        to_value=to_value,
        from_year=from_year,
        to_year=to_year,
        nominal_change_percent=nominal,
        real_change_percent=real,
        inflation_percent=inflation,
        from_value_in_to_year_dollars=adjusted_from,
        status=conversion.status,
        reason=reason,
    )


def table_as_dict(table: CpiTable, start_year: int | None = None, end_year: int | None = None) -> dict:
    """The annual table as JSON, optionally limited to a range of years."""
    entries = []
    for year in sorted(table.years):
        if start_year is not None and year < start_year:
            continue
        if end_year is not None and year > end_year:
            continue
        entries.append(table.years[year].as_dict())
    return {
        "indicator_id": CPI_INDICATOR_ID,
        "label": cpi_indicator_label(),
        "method": (
            f"Each year's CPI is the average of its {MONTHS_PER_YEAR} monthly values. "
            "A year missing any month has no annual value and is never estimated."
        ),
        "coverage": "Canada, all items. Not a Toronto or housing-specific index.",
        "latest_complete_year": table.latest_complete_year(),
        "earliest_complete_year": table.earliest_complete_year(),
        "years": entries,
        "source": table.source.as_dict() if table.source else None,
    }
