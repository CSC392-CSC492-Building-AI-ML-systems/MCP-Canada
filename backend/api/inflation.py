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
    #: Every published month, keyed by (year, month). Empty when built from annual values only.
    months: dict[tuple[int, int], Decimal] = field(default_factory=dict)

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
    return CpiTable(years=annual_cpi_from_months(months), source=source, months=months_by_period(months))


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
        "latest_twelve_months": latest_twelve_months_dict(table),
        "source": table.source.as_dict() if table.source else None,
    }


def latest_twelve_months_dict(table: CpiTable) -> dict | None:
    """The latest twelve consecutive months as JSON, or None when there is no such run."""
    trailing = latest_trailing_cpi(table)
    if trailing is None:
        return None
    return trailing.as_dict()


# =========================================================================== deeper calculations
#
# Everything below builds on the annual table above. None of it is used by a page yet.


# --------------------------------------------------------------------------- months

def months_by_period(months: list[MonthlyCpi]) -> dict[tuple[int, int], Decimal]:
    """Monthly CPI keyed by (year, month). A duplicated month keeps its first value."""
    table: dict[tuple[int, int], Decimal] = {}
    for entry in months:
        key = (entry.year, entry.month)
        if key not in table:
            table[key] = entry.value
    return table


def period_label(year: int, month: int) -> str:
    """A 'YYYY-MM' label for a month."""
    return f"{year:04d}-{month:02d}"


def parse_month_period(raw, name: str = "period") -> tuple[int, int]:
    """Read a 'YYYY-MM' month from user input. Raises InvalidInflationRequest with a clear message."""
    if raw is None or str(raw).strip() == "":
        raise InvalidInflationRequest(f"Missing {name}. Give a month as YYYY-MM, such as 2011-05.")
    parsed = parse_period(str(raw).strip())
    if parsed is None:
        raise InvalidInflationRequest(f"{name} must be a month written as YYYY-MM, such as 2011-05.")
    year, month = parsed
    if year < EARLIEST_ACCEPTED_YEAR or year > LATEST_ACCEPTED_YEAR:
        raise InvalidInflationRequest(
            f"{name} must be between {EARLIEST_ACCEPTED_YEAR} and {LATEST_ACCEPTED_YEAR}, not {year}."
        )
    return year, month


def adjust_between_months(
    amount: Decimal,
    from_period: tuple[int, int],
    to_period: tuple[int, int],
    table: CpiTable,
) -> AdjustmentResult:
    """Convert an amount between two exact months, using the monthly CPI.

    This is more precise than the annual conversion when a value refers to a
    specific month, for example Census day in May. The result reports the years
    of the two months; the reason names the month when one is missing.
    """
    from_year, from_month = from_period
    to_year, to_month = to_period
    if from_period == to_period:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_SAME_YEAR,
            adjusted_value=amount,
            factor=Decimal(1),
        )
    from_cpi = table.months.get(from_period)
    if from_cpi is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason=f"No CPI is published for {period_label(from_year, from_month)}.",
        )
    to_cpi = table.months.get(to_period)
    if to_cpi is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason=f"No CPI is published for {period_label(to_year, to_month)}.",
        )
    factor = to_cpi / from_cpi
    return AdjustmentResult(
        original_value=amount,
        from_year=from_year,
        to_year=to_year,
        status=STATUS_ADJUSTED,
        adjusted_value=amount * factor,
        factor=factor,
    )


# --------------------------------------------------------------------------- latest 12 months

@dataclass(frozen=True)
class TrailingCpi:
    """The average CPI of the most recent twelve consecutive published months."""

    value: Decimal
    first_period: str
    last_period: str

    @property
    def label(self) -> str:
        """For example 'the 12 months from 2025-10 to 2026-09'."""
        return f"the 12 months from {self.first_period} to {self.last_period}"

    def as_dict(self) -> dict:
        """JSON-ready form."""
        return {
            "value": decimal_to_string(self.value, places=4),
            "first_period": self.first_period,
            "last_period": self.last_period,
            "label": self.label,
        }


def previous_month(year: int, month: int) -> tuple[int, int]:
    """The month before the given one."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def latest_trailing_cpi(table: CpiTable) -> TrailingCpi | None:
    """The average of the latest twelve consecutive months, or None if there is no such run.

    This is not an annual CPI. It lets a value be shown in near-current dollars
    while the current calendar year is still incomplete, and it always says
    which months it covers.
    """
    if not table.months:
        return None
    latest = max(table.months)
    periods = [latest]
    while len(periods) < MONTHS_PER_YEAR:
        periods.append(previous_month(*periods[-1]))
    values = [table.months.get(period) for period in periods]
    if any(value is None for value in values):
        return None
    average = sum(values, Decimal(0)) / Decimal(MONTHS_PER_YEAR)
    first = periods[-1]
    return TrailingCpi(value=average, first_period=period_label(*first), last_period=period_label(*latest))


def adjust_to_latest_months(amount: Decimal, from_year: int, table: CpiTable) -> tuple[AdjustmentResult, TrailingCpi | None]:
    """Convert an amount from a complete year into dollars of the latest twelve months."""
    trailing = latest_trailing_cpi(table)
    from_cpi = table.value_for(from_year)
    to_year = int(trailing.last_period[:4]) if trailing else from_year
    if trailing is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason="The loaded CPI does not have twelve consecutive recent months.",
        ), None
    if from_cpi is None:
        return AdjustmentResult(
            original_value=amount,
            from_year=from_year,
            to_year=to_year,
            status=STATUS_NOT_ADJUSTED,
            reason=table.missing_reason(from_year),
        ), trailing
    factor = trailing.value / from_cpi
    return AdjustmentResult(
        original_value=amount,
        from_year=from_year,
        to_year=to_year,
        status=STATUS_ADJUSTED,
        adjusted_value=amount * factor,
        factor=factor,
    ), trailing


# --------------------------------------------------------------------------- rates and indexes

def annualized_inflation(from_year: int, to_year: int, table: CpiTable) -> Decimal | None:
    """The average yearly inflation rate between two years, as a percent (compound).

    Prices rising 20% over 10 years is about 1.84% a year, not 2%, because each
    year's rise builds on the last. None when either year has no CPI.
    """
    if from_year == to_year:
        return Decimal(0)
    from_cpi = table.value_for(from_year)
    to_cpi = table.value_for(to_year)
    if from_cpi is None or to_cpi is None:
        return None
    years = to_year - from_year
    ratio = float(to_cpi / from_cpi)
    rate = (ratio ** (1 / years) - 1) * 100
    return Decimal(str(rate))


def year_over_year(table: CpiTable) -> list[dict]:
    """Each complete year's inflation compared with the year before.

    A year whose previous year is incomplete or missing gets None, never an
    estimate across a gap.
    """
    rows = []
    for year in table.complete_years():
        previous = table.value_for(year - 1)
        current = table.value_for(year)
        rate = None
        if previous is not None and current is not None:
            rate = (current / previous - Decimal(1)) * Decimal(100)
        rows.append({
            "year": year,
            "annual_cpi": decimal_to_string(current, places=4),
            "inflation_percent": decimal_to_string(rate, places=2),
        })
    return rows


def rebase(table: CpiTable, base_year: int) -> dict[int, Decimal]:
    """Every complete year's CPI on a new base where base_year = 100.

    Raises InvalidInflationRequest when the base year has no complete CPI.
    """
    base = table.value_for(base_year)
    if base is None:
        raise InvalidInflationRequest(f"{base_year} cannot be the base year: {table.missing_reason(base_year)}")
    return {year: table.value_for(year) / base * Decimal(100) for year in table.complete_years()}


# --------------------------------------------------------------------------- Census reference years

#: How far each kind of Census value's reference year is from the Census year.
#: Census income (for example the 2021 Census) describes the previous calendar year (2020),
#: while shelter costs and rents describe the Census year itself.
CENSUS_REFERENCE_OFFSETS = {
    "income": -1,
    "after_tax_income": -1,
    "shelter_cost": 0,
    "rent": 0,
}


def census_reference_year(census_year: int, measure: str) -> int:
    """The year a Census value actually refers to, so it is adjusted with the right CPI."""
    if measure not in CENSUS_REFERENCE_OFFSETS:
        known = ", ".join(sorted(CENSUS_REFERENCE_OFFSETS))
        raise InvalidInflationRequest(f"Unknown Census measure {measure!r}. Use one of: {known}.")
    return census_year + CENSUS_REFERENCE_OFFSETS[measure]


def adjust_census_value(amount: Decimal, census_year: int, measure: str, to_year: int, table: CpiTable) -> AdjustmentResult:
    """Adjust a Census value from the year it refers to (not just the Census year)."""
    return adjust_amount(amount, census_reference_year(census_year, measure), to_year, table)


# --------------------------------------------------------------------------- series

def parse_series(raw, name: str = "values") -> list[tuple[int, Decimal]]:
    """Read 'YEAR:AMOUNT' pairs separated by commas, such as '2011:1000,2021:1300'."""
    if raw is None or str(raw).strip() == "":
        raise InvalidInflationRequest(f"Missing {name}. Give YEAR:AMOUNT pairs, such as 2011:1000,2021:1300.")
    pairs = []
    seen = set()
    for part in str(raw).split(","):
        piece = part.strip()
        if not piece:
            continue
        if piece.count(":") != 1:
            raise InvalidInflationRequest(f"Each item in {name} must be YEAR:AMOUNT, not {piece!r}.")
        year_text, amount_text = piece.split(":")
        year = parse_year(year_text, f"year in {name}")
        if year in seen:
            raise InvalidInflationRequest(f"{year} appears more than once in {name}.")
        seen.add(year)
        pairs.append((year, parse_amount(amount_text, f"amount for {year}")))
    if not pairs:
        raise InvalidInflationRequest(f"Missing {name}. Give YEAR:AMOUNT pairs, such as 2011:1000,2021:1300.")
    if len(pairs) > 50:
        raise InvalidInflationRequest(f"{name} can hold at most 50 values.")
    return pairs


def adjust_series(pairs: list[tuple[int, Decimal]], to_year: int, table: CpiTable) -> list[AdjustmentResult]:
    """Convert every (year, amount) pair into to_year dollars, oldest first."""
    return [adjust_amount(amount, year, to_year, table) for year, amount in sorted(pairs)]


# --------------------------------------------------------------------------- affordability over time

#: The share of income the project uses as its affordability reference point (CMHC's 30%).
AFFORDABILITY_GUIDELINE_PERCENT = Decimal(30)


@dataclass(frozen=True)
class AffordabilityPoint:
    """Rent as a share of income in one year."""

    year: int
    monthly_rent: Decimal
    annual_income: Decimal
    share_of_income_percent: Decimal | None
    meets_guideline: bool | None

    def as_dict(self) -> dict:
        """JSON-ready form."""
        return {
            "year": self.year,
            "monthly_rent": decimal_to_string(self.monthly_rent, places=2),
            "annual_income": decimal_to_string(self.annual_income, places=2),
            "share_of_income_percent": decimal_to_string(self.share_of_income_percent, places=2),
            "meets_guideline": self.meets_guideline,
        }


def affordability_point(year: int, monthly_rent: Decimal, annual_income: Decimal) -> AffordabilityPoint:
    """Rent ÷ monthly income for one year. Rent and income are from the same year, so no CPI is needed."""
    if annual_income <= 0:
        return AffordabilityPoint(year, monthly_rent, annual_income, None, None)
    share = monthly_rent / (annual_income / Decimal(12)) * Decimal(100)
    return AffordabilityPoint(year, monthly_rent, annual_income, share, share <= AFFORDABILITY_GUIDELINE_PERCENT)


def parse_affordability_points(raw, name: str = "points") -> list[tuple[int, Decimal, Decimal]]:
    """Read 'YEAR:MONTHLY_RENT:ANNUAL_INCOME' triples separated by commas."""
    if raw is None or str(raw).strip() == "":
        raise InvalidInflationRequest(
            f"Missing {name}. Give YEAR:MONTHLY_RENT:ANNUAL_INCOME items, such as 2011:1000:60000,2021:1300:72000."
        )
    triples = []
    seen = set()
    for part in str(raw).split(","):
        piece = part.strip()
        if not piece:
            continue
        bits = piece.split(":")
        if len(bits) != 3:
            raise InvalidInflationRequest(f"Each item in {name} must be YEAR:MONTHLY_RENT:ANNUAL_INCOME, not {piece!r}.")
        year = parse_year(bits[0], f"year in {name}")
        if year in seen:
            raise InvalidInflationRequest(f"{year} appears more than once in {name}.")
        seen.add(year)
        triples.append((year, parse_amount(bits[1], f"rent for {year}"), parse_amount(bits[2], f"income for {year}")))
    if len(triples) < 2:
        raise InvalidInflationRequest(f"{name} needs at least two years to show a trend.")
    if len(triples) > 50:
        raise InvalidInflationRequest(f"{name} can hold at most 50 values.")
    return sorted(triples)


def affordability_trend(triples: list[tuple[int, Decimal, Decimal]], table: CpiTable) -> dict:
    """How rent compared with income across years, and how each grew after inflation.

    * The share of income needs no inflation adjustment, because each year's rent
      and income are in that same year's dollars.
    * The change in share, in percentage points, says whether rent became harder
      or easier to afford relative to income.
    * Rent and income growth are each given before and after inflation, so the
      result can say whether rent outpaced income.
    """
    ordered = sorted(triples)
    points = [affordability_point(year, rent, income) for year, rent, income in ordered]
    first, last = ordered[0], ordered[-1]
    first_point, last_point = points[0], points[-1]

    share_change = None
    if first_point.share_of_income_percent is not None and last_point.share_of_income_percent is not None:
        share_change = last_point.share_of_income_percent - first_point.share_of_income_percent

    rent = real_change(first[1], last[1], first[0], last[0], table)
    income = real_change(first[2], last[2], first[0], last[0], table)

    outpaced = None
    if rent.nominal_change_percent is not None and income.nominal_change_percent is not None:
        outpaced = rent.nominal_change_percent > income.nominal_change_percent

    if share_change is None:
        summary = "The share of income cannot be compared because an income is $0."
    elif share_change > 0:
        summary = (f"Rent took a larger share of income in {last[0]} than in {first[0]} "
                   f"(up {decimal_to_string(share_change, 1)} percentage points).")
    elif share_change < 0:
        summary = (f"Rent took a smaller share of income in {last[0]} than in {first[0]} "
                   f"(down {decimal_to_string(-share_change, 1)} percentage points).")
    else:
        summary = f"Rent took the same share of income in {first[0]} and {last[0]}."

    return {
        "points": [point.as_dict() for point in points],
        "first_year": first[0],
        "last_year": last[0],
        "share_change_points": decimal_to_string(share_change, places=2),
        "rent_change": rent.as_dict(),
        "income_change": income.as_dict(),
        "rent_outpaced_income": outpaced,
        "guideline_percent": decimal_to_string(AFFORDABILITY_GUIDELINE_PERCENT, places=0),
        "summary": summary,
    }
