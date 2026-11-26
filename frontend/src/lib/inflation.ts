/**
 * Inflation adjustment for the frontend.
 *
 * What this file does
 * -------------------
 * Converts dollar amounts between years using Canada's annual Consumer Price
 * Index (CPI), so values from different Census years can be compared fairly:
 *
 *     value in target year = value × (CPI in target year ÷ CPI in original year)
 *
 * The annual CPI comes from the backend (`GET /api/cpi/annual/`), which averages
 * the twelve monthly CPI values for each year stored in the database. A year
 * without all twelve months has no annual value.
 *
 * Nothing on screen uses this file yet. It is ready for any view that wants to
 * show dollars "as published" or "in YYYY dollars" (for example the across-time
 * panel). Every function is pure except `loadAnnualCpi`, which fetches.
 *
 * Rules every caller can rely on
 * ------------------------------
 * - A year without a complete CPI is never guessed: results say "not_adjusted"
 *   and give the reason.
 * - The same year in and out returns the same value unchanged.
 * - Missing, negative or non-finite amounts are never converted.
 * - The CPI is national and covers all items. It is not a Toronto or housing index,
 *   so labels should say so (see `ADJUSTMENT_NOTE`).
 */

// ------------------------------------------------------------------ constants

/** Backend route that returns the annual CPI table. */
export const CPI_ANNUAL_URL = "/api/cpi/annual/";

/** The basis used for values exactly as the source published them. */
export const NOMINAL_BASIS = "nominal" as const;

/** One line that should appear wherever adjusted dollars are shown. */
export const ADJUSTMENT_NOTE =
  "Adjusted with Canada's all-items Consumer Price Index (Statistics Canada). " +
  "This is national general inflation, not a Toronto housing index.";

/** One line that should appear wherever published (unadjusted) dollars are shown. */
export const NOMINAL_NOTE = "Dollar values are as published (nominal), not adjusted for inflation.";

// ------------------------------------------------------------------ types

/** One year's row from `/api/cpi/annual/`. `value` is text so no precision is lost. */
export type AnnualCpiRow = {
  year: number;
  value: string | null;
  months_counted: number;
  status: "complete" | "incomplete";
};

/** Where the CPI came from, as the backend reports it. */
export type CpiSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  retrieved_at: string | null;
};

/** The full response from `/api/cpi/annual/`. */
export type AnnualCpiResponse = {
  indicator_id: string;
  label: string | null;
  method: string;
  coverage: string;
  latest_complete_year: number | null;
  earliest_complete_year: number | null;
  years: AnnualCpiRow[];
  source: CpiSource | null;
};

/** Annual CPI ready for calculations: complete years only, plus why other years are missing. */
export type CpiTable = {
  /** Annual CPI by year, for complete years only. */
  values: Map<number, number>;
  /** Plain-language reason for every year in the series that has no annual value. */
  gaps: Map<number, string>;
  latestCompleteYear: number | null;
  earliestCompleteYear: number | null;
  source: CpiSource | null;
};

/** What happened when one amount was converted. */
export type AdjustmentStatus = "adjusted" | "same_year" | "not_adjusted";

/** The result of converting one amount from one year's dollars into another's. */
export type Adjustment = {
  status: AdjustmentStatus;
  /** The amount as given. */
  original: number | null;
  /** The amount in `toYear` dollars, or null when it could not be converted. */
  value: number | null;
  fromYear: number;
  toYear: number;
  /** CPI(toYear) ÷ CPI(fromYear); 1 for the same year; null when not adjusted. */
  factor: number | null;
  /** Why nothing was converted, when status is "not_adjusted". */
  reason: string | null;
};

/** A value's change between two years, before and after inflation. */
export type RealChange = {
  status: AdjustmentStatus;
  fromYear: number;
  toYear: number;
  fromValue: number;
  toValue: number;
  /** Percent change of the published values; null when the starting value is 0. */
  nominalPercent: number | null;
  /** Percent change after converting the starting value into `toYear` dollars. */
  realPercent: number | null;
  /** How much prices rose between the two years, as a percent. */
  inflationPercent: number | null;
  /** The starting value in `toYear` dollars. */
  fromValueAdjusted: number | null;
  reason: string | null;
};

/** One point in a series of yearly values, such as a neighbourhood's rent by Census year. */
export type YearValue = { year: number; value: number | null };

/** A series point after conversion, keeping the original value beside the adjusted one. */
export type AdjustedYearValue = YearValue & { adjustment: Adjustment };

/** One choice for a "show dollars as…" control. */
export type DollarBasisOption = { id: string; label: string; year: number | null };

// ------------------------------------------------------------------ checking inputs

/** True when the value is a real, non-negative, finite number. */
export function isUsableAmount(value: number | null | undefined): value is number {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== "number") {
    return false;
  }
  if (!Number.isFinite(value)) {
    return false;
  }
  return value >= 0;
}

/** True when the value is a whole-number year between 1900 and 2100. */
export function isUsableYear(year: number | null | undefined): year is number {
  if (year === null || year === undefined) {
    return false;
  }
  if (!Number.isInteger(year)) {
    return false;
  }
  return year >= 1900 && year <= 2100;
}

/** Percent change from `before` to `after`; null when `before` is 0. */
export function percentChange(before: number, after: number): number | null {
  if (before === 0) {
    return null;
  }
  return ((after - before) / before) * 100;
}

// ------------------------------------------------------------------ building the table

/** Turns the backend's annual rows into a CPI table, ignoring rows that are not usable. */
export function buildCpiTable(response: Pick<AnnualCpiResponse, "years"> & Partial<AnnualCpiResponse>): CpiTable {
  const values = new Map<number, number>();
  const gaps = new Map<number, string>();

  for (const row of response.years ?? []) {
    if (!row || !isUsableYear(row.year)) {
      continue;
    }
    const parsed = row.value === null ? Number.NaN : Number(row.value);
    const usable = row.status === "complete" && Number.isFinite(parsed) && parsed > 0;
    if (usable) {
      values.set(row.year, parsed);
      gaps.delete(row.year);
    } else if (!values.has(row.year)) {
      gaps.set(row.year, gapReason(row));
    }
  }

  const completeYears = [...values.keys()].sort((a, b) => a - b);
  return {
    values,
    gaps,
    latestCompleteYear: completeYears.length ? completeYears[completeYears.length - 1] : null,
    earliestCompleteYear: completeYears.length ? completeYears[0] : null,
    source: response.source ?? null,
  };
}

/** Why a row from the backend has no usable annual value. */
function gapReason(row: AnnualCpiRow): string {
  if (row.status === "incomplete" && row.months_counted < 12) {
    return `${row.year} has CPI for only ${row.months_counted} of 12 months, so it has no annual average yet.`;
  }
  return `No annual CPI is available for ${row.year}.`;
}

/** The reason a year cannot be used, whether it is a known gap or outside the series. */
export function missingYearReason(year: number, table: CpiTable): string {
  const known = table.gaps.get(year);
  if (known) {
    return known;
  }
  return `No CPI is published for ${year} in the loaded data.`;
}

/** Every year with a complete annual CPI, oldest first. */
export function completeYears(table: CpiTable): number[] {
  return [...table.values.keys()].sort((a, b) => a - b);
}

/** True when the year has a complete annual CPI. */
export function hasCpiFor(year: number, table: CpiTable): boolean {
  return table.values.has(year);
}

// ------------------------------------------------------------------ calculations

/** Converts an amount from `fromYear` dollars into `toYear` dollars. */
export function adjustForInflation(
  amount: number | null | undefined,
  fromYear: number,
  toYear: number,
  table: CpiTable,
): Adjustment {
  const original = amount === undefined ? null : amount;
  const notAdjusted = (reason: string): Adjustment => ({
    status: "not_adjusted",
    original,
    value: null,
    fromYear,
    toYear,
    factor: null,
    reason,
  });

  if (!isUsableAmount(amount)) {
    return notAdjusted("There is no usable amount to convert.");
  }
  if (!isUsableYear(fromYear)) {
    return notAdjusted(`${fromYear} is not a valid year.`);
  }
  if (!isUsableYear(toYear)) {
    return notAdjusted(`${toYear} is not a valid year.`);
  }

  if (fromYear === toYear) {
    return {
      status: "same_year",
      original: amount,
      value: amount,
      fromYear,
      toYear,
      factor: 1,
      reason: null,
    };
  }

  const fromCpi = table.values.get(fromYear);
  if (fromCpi === undefined) {
    return notAdjusted(missingYearReason(fromYear, table));
  }
  const toCpi = table.values.get(toYear);
  if (toCpi === undefined) {
    return notAdjusted(missingYearReason(toYear, table));
  }

  const factor = toCpi / fromCpi;
  return {
    status: "adjusted",
    original: amount,
    value: amount * factor,
    fromYear,
    toYear,
    factor,
    reason: null,
  };
}

/** How much prices rose between two years, as a percent; null when either year has no CPI. */
export function inflationBetween(fromYear: number, toYear: number, table: CpiTable): number | null {
  if (!isUsableYear(fromYear) || !isUsableYear(toYear)) {
    return null;
  }
  if (fromYear === toYear) {
    return 0;
  }
  const fromCpi = table.values.get(fromYear);
  const toCpi = table.values.get(toYear);
  if (fromCpi === undefined || toCpi === undefined) {
    return null;
  }
  return (toCpi / fromCpi - 1) * 100;
}

/** Compares two values from different years, before and after taking out inflation. */
export function realChange(
  fromValue: number,
  toValue: number,
  fromYear: number,
  toYear: number,
  table: CpiTable,
): RealChange {
  const usableValues = isUsableAmount(fromValue) && isUsableAmount(toValue);
  const nominalPercent = usableValues ? percentChange(fromValue, toValue) : null;
  const conversion = adjustForInflation(fromValue, fromYear, toYear, table);

  if (!usableValues || conversion.status === "not_adjusted" || conversion.value === null) {
    return {
      status: "not_adjusted",
      fromYear,
      toYear,
      fromValue,
      toValue,
      nominalPercent,
      realPercent: null,
      inflationPercent: null,
      fromValueAdjusted: null,
      reason: usableValues ? conversion.reason : "Both values must be usable amounts of $0 or more.",
    };
  }

  const realPercent = percentChange(conversion.value, toValue);
  return {
    status: conversion.status,
    fromYear,
    toYear,
    fromValue,
    toValue,
    nominalPercent,
    realPercent,
    inflationPercent: inflationBetween(fromYear, toYear, table),
    fromValueAdjusted: conversion.value,
    reason: realPercent === null ? "The starting value is $0, so there is no percent change." : null,
  };
}

/** Converts every value in a series into `toYear` dollars, keeping each original value. */
export function adjustSeries(series: YearValue[], toYear: number, table: CpiTable): AdjustedYearValue[] {
  const result: AdjustedYearValue[] = [];
  for (const point of series) {
    const adjustment = adjustForInflation(point.value, point.year, toYear, table);
    result.push({ year: point.year, value: point.value, adjustment });
  }
  return result;
}

// ------------------------------------------------------------------ labels for whoever shows it

/** A short label for the dollars a value is in, such as "2011 dollars" or "Adjusted to 2021 dollars". */
export function dollarLabel(adjustment: Adjustment): string {
  if (adjustment.status === "adjusted") {
    return `Adjusted to ${adjustment.toYear} dollars`;
  }
  if (adjustment.status === "same_year") {
    return `${adjustment.toYear} dollars`;
  }
  return `${adjustment.fromYear} dollars, not adjusted`;
}

/** A one-sentence description of a real change, for summaries and the AI teacher. */
export function describeRealChange(change: RealChange, formatPercent: (n: number) => string = defaultPercent): string {
  if (change.nominalPercent === null) {
    return `There is no percent change from a starting value of $0 (${change.fromYear}).`;
  }
  const nominal = `${signed(change.nominalPercent, formatPercent)} as published`;
  if (change.status === "not_adjusted" || change.realPercent === null) {
    const why = change.reason ? ` Not adjusted for inflation: ${change.reason}` : "";
    return `${change.fromYear} to ${change.toYear}: ${nominal}.${why}`;
  }
  if (change.status === "same_year") {
    return `${change.fromYear}: ${nominal}; both values are from the same year.`;
  }
  return `${change.fromYear} to ${change.toYear}: ${nominal}, ${signed(change.realPercent, formatPercent)} after inflation.`;
}

function defaultPercent(n: number): string {
  return `${Math.round(Math.abs(n) * 10) / 10}%`;
}

function signed(n: number, formatPercent: (n: number) => string): string {
  if (n > 0) {
    return `up ${formatPercent(n)}`;
  }
  if (n < 0) {
    return `down ${formatPercent(n)}`;
  }
  return "no change";
}

/** Choices for a "show dollars as…" control: as published, plus each requested year that has CPI. */
export function dollarBasisOptions(table: CpiTable, targetYears: number[]): DollarBasisOption[] {
  const options: DollarBasisOption[] = [{ id: NOMINAL_BASIS, label: "As published", year: null }];
  const seen = new Set<number>();
  for (const year of targetYears) {
    if (seen.has(year)) {
      continue;
    }
    seen.add(year);
    if (hasCpiFor(year, table)) {
      options.push({ id: String(year), label: `In ${year} dollars`, year });
    }
  }
  return options;
}

// ------------------------------------------------------------------ loading from the backend

let cached: { promise: Promise<CpiTable> } | null = null;

/** True when the value has the shape of `/api/cpi/annual/`'s response. */
export function isAnnualCpiResponse(value: unknown): value is AnnualCpiResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const years = (value as { years?: unknown }).years;
  if (!Array.isArray(years)) {
    return false;
  }
  return years.every(row =>
    !!row && typeof row === "object"
    && typeof (row as AnnualCpiRow).year === "number"
    && ((row as AnnualCpiRow).value === null || typeof (row as AnnualCpiRow).value === "string")
    && ((row as AnnualCpiRow).status === "complete" || (row as AnnualCpiRow).status === "incomplete"));
}

/**
 * Fetches the annual CPI once per page load and reuses it. A failed request is not
 * cached, so the next call tries again.
 */
export function loadAnnualCpi(fetcher: typeof fetch = fetch): Promise<CpiTable> {
  if (cached) {
    return cached.promise;
  }
  const promise = (async () => {
    const response = await fetcher(CPI_ANNUAL_URL);
    if (!response.ok) {
      throw new Error(`Could not load CPI for inflation adjustment (HTTP ${response.status}).`);
    }
    const data: unknown = await response.json();
    if (!isAnnualCpiResponse(data)) {
      throw new Error("The CPI response was not in the expected format.");
    }
    return buildCpiTable(data);
  })();
  cached = { promise };
  promise.catch(() => {
    if (cached?.promise === promise) {
      cached = null;
    }
  });
  return promise;
}

/** Forgets the loaded CPI, so the next `loadAnnualCpi` call fetches again (used by tests). */
export function clearCpiCache(): void {
  cached = null;
}
