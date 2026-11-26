/**
 * Tests for inflation adjustment (inflation.ts).
 *
 * Grouped the way the project plan's testing framework (Section 7, Layer 1) asks for:
 * normal, boundary and missing-data cases, plus input validation. The fixture CPI uses
 * round numbers so every expected value can be checked by hand:
 *
 *   2011 → 100, 2016 → 110, 2021 → 120 (complete years)
 *   2015 → 11 months only, 2026 → 9 months only (incomplete years)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFFORDABILITY_GUIDELINE_PERCENT,
  CENSUS_REFERENCE_OFFSETS,
  adjustCensusValue,
  adjustToLatestMonths,
  affordabilityPoint,
  affordabilityTrend,
  annualizedInflation,
  applyDollarBasis,
  basisNote,
  censusReferenceYear,
  rebaseCpi,
  yearOverYear,
  ADJUSTMENT_NOTE,
  CPI_ANNUAL_URL,
  NOMINAL_BASIS,
  NOMINAL_NOTE,
  adjustForInflation,
  adjustSeries,
  buildCpiTable,
  clearCpiCache,
  completeYears,
  describeRealChange,
  dollarBasisOptions,
  dollarLabel,
  hasCpiFor,
  inflationBetween,
  isAnnualCpiResponse,
  isUsableAmount,
  isUsableYear,
  loadAnnualCpi,
  missingYearReason,
  percentChange,
  realChange,
  type AnnualCpiResponse,
  type AnnualCpiRow,
  type CpiTable,
} from "./inflation";

// ------------------------------------------------------------------ fixtures

const ROWS: AnnualCpiRow[] = [
  { year: 2011, value: "100.0000", months_counted: 12, status: "complete" },
  { year: 2015, value: null, months_counted: 11, status: "incomplete" },
  { year: 2016, value: "110.0000", months_counted: 12, status: "complete" },
  { year: 2021, value: "120.0000", months_counted: 12, status: "complete" },
  { year: 2026, value: null, months_counted: 9, status: "incomplete" },
];

const RESPONSE: AnnualCpiResponse = {
  indicator_id: "canada-cpi-v41690973",
  label: "Canada all-items CPI, not seasonally adjusted",
  method: "Each year's CPI is the average of its 12 monthly values.",
  coverage: "Canada, all items.",
  latest_complete_year: 2021,
  earliest_complete_year: 2011,
  years: ROWS,
  source: { id: "cpi-test", title: "Fixture CPI", publisher: "Synthetic fixture", url: "https://example.org/cpi", retrieved_at: null },
};

const table = (): CpiTable => buildCpiTable(RESPONSE);

/** A fetch stand-in that answers with the given status and body. */
function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

// ------------------------------------------------------------------ checking inputs

describe("input checks", () => {
  describe("isUsableAmount", () => {
    it.each([0, 1, 1800, 1234.56, Number.MAX_SAFE_INTEGER])("accepts %s", (value) => {
      expect(isUsableAmount(value)).toBe(true);
    });

    it.each([-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined])(
      "rejects %s",
      (value) => {
        expect(isUsableAmount(value)).toBe(false);
      },
    );

    it("rejects values that are not numbers", () => {
      expect(isUsableAmount("1000" as unknown as number)).toBe(false);
    });
  });

  describe("isUsableYear", () => {
    it.each([1900, 2011, 2021, 2100])("accepts %s", (year) => {
      expect(isUsableYear(year)).toBe(true);
    });

    it.each([1899, 2101, 2011.5, Number.NaN, null, undefined])("rejects %s", (year) => {
      expect(isUsableYear(year)).toBe(false);
    });
  });

  describe("percentChange", () => {
    it.each([
      [100, 125, 25],
      [100, 80, -20],
      [100, 100, 0],
      [1000, 1300, 30],
    ])("from %s to %s is %s%%", (before, after, expected) => {
      expect(percentChange(before, after)).toBeCloseTo(expected, 10);
    });

    it("has no percent change from zero", () => {
      expect(percentChange(0, 500)).toBeNull();
    });
  });
});

// ------------------------------------------------------------------ building the table

describe("buildCpiTable", () => {
  describe("normal cases", () => {
    it("keeps the annual CPI for every complete year", () => {
      const t = table();
      expect(t.values.get(2011)).toBe(100);
      expect(t.values.get(2016)).toBe(110);
      expect(t.values.get(2021)).toBe(120);
    });

    it("finds the earliest and latest complete years", () => {
      const t = table();
      expect(t.earliestCompleteYear).toBe(2011);
      expect(t.latestCompleteYear).toBe(2021);
    });

    it("keeps the source so adjusted values can name it", () => {
      expect(table().source?.publisher).toBe("Synthetic fixture");
    });

    it("lists complete years oldest first, whatever order the rows came in", () => {
      const t = buildCpiTable({ years: [...ROWS].reverse() });
      expect(completeYears(t)).toEqual([2011, 2016, 2021]);
    });
  });

  describe("missing data", () => {
    it("records why each incomplete year has no value", () => {
      const t = table();
      expect(t.values.has(2026)).toBe(false);
      expect(t.gaps.get(2026)).toBe("2026 has CPI for only 9 of 12 months, so it has no annual average yet.");
      expect(t.gaps.get(2015)).toBe("2015 has CPI for only 11 of 12 months, so it has no annual average yet.");
    });

    it("gives an empty table for no rows", () => {
      const t = buildCpiTable({ years: [] });
      expect(t.values.size).toBe(0);
      expect(t.latestCompleteYear).toBeNull();
      expect(t.earliestCompleteYear).toBeNull();
      expect(t.source).toBeNull();
    });

    it("treats a complete row without a value as a gap", () => {
      const t = buildCpiTable({ years: [{ year: 2030, value: null, months_counted: 12, status: "complete" }] });
      expect(t.values.has(2030)).toBe(false);
      expect(t.gaps.get(2030)).toBe("No annual CPI is available for 2030.");
    });

    it("explains a year outside the series", () => {
      expect(missingYearReason(1999, table())).toBe("No CPI is published for 1999 in the loaded data.");
    });
  });

  describe("input validation", () => {
    it.each(["abc", "0", "-5", "Infinity"])("ignores a complete row whose value is %s", (value) => {
      const t = buildCpiTable({ years: [{ year: 2020, value, months_counted: 12, status: "complete" }] });
      expect(t.values.has(2020)).toBe(false);
    });

    it("ignores rows with an unusable year", () => {
      const t = buildCpiTable({ years: [{ year: 2011.5, value: "100", months_counted: 12, status: "complete" }] });
      expect(t.values.size).toBe(0);
      expect(t.gaps.size).toBe(0);
    });

    it("a later complete row for the same year wins over an earlier gap", () => {
      const t = buildCpiTable({ years: [
        { year: 2020, value: null, months_counted: 11, status: "incomplete" },
        { year: 2020, value: "130", months_counted: 12, status: "complete" },
      ] });
      expect(t.values.get(2020)).toBe(130);
      expect(t.gaps.has(2020)).toBe(false);
    });

    it("a later gap never removes a complete year", () => {
      const t = buildCpiTable({ years: [
        { year: 2020, value: "130", months_counted: 12, status: "complete" },
        { year: 2020, value: null, months_counted: 11, status: "incomplete" },
      ] });
      expect(t.values.get(2020)).toBe(130);
      expect(t.gaps.has(2020)).toBe(false);
    });
  });

  it("hasCpiFor is true only for complete years", () => {
    const t = table();
    expect(hasCpiFor(2021, t)).toBe(true);
    expect(hasCpiFor(2026, t)).toBe(false);
    expect(hasCpiFor(1999, t)).toBe(false);
  });
});

// ------------------------------------------------------------------ adjustForInflation

describe("adjustForInflation", () => {
  describe("normal cases", () => {
    it("converts the project plan example: $1,000 in 2011 into 2021 dollars", () => {
      const result = adjustForInflation(1000, 2011, 2021, table());
      expect(result.status).toBe("adjusted");
      expect(Math.abs(result.value! - 1200)).toBeLessThanOrEqual(1);
      expect(result.factor).toBeCloseTo(1.2, 10);
      expect(result.original).toBe(1000);
      expect(result.reason).toBeNull();
    });

    it.each([
      [1000, 2011, 2016, 1100],
      [1100, 2016, 2021, 1200],
      [1200, 2021, 2011, 1000],
      [550, 2016, 2011, 500],
      [1234.56, 2011, 2021, 1481.472],
    ])("$%s in %s is $%s in %s dollars", (amount, from, to, expected) => {
      expect(adjustForInflation(amount, from, to, table()).value).toBeCloseTo(expected, 6);
    });

    it("a round trip returns the original amount", () => {
      const there = adjustForInflation(1000, 2011, 2021, table());
      const back = adjustForInflation(there.value, 2021, 2011, table());
      expect(back.value).toBeCloseTo(1000, 9);
    });
  });

  describe("boundary cases", () => {
    it("the same year in and out returns the same value", () => {
      const result = adjustForInflation(1000, 2016, 2016, table());
      expect(result.status).toBe("same_year");
      expect(result.value).toBe(1000);
      expect(result.factor).toBe(1);
    });

    it("the same year works even when that year has no CPI", () => {
      expect(adjustForInflation(800, 2026, 2026, table()).value).toBe(800);
    });

    it("zero stays zero", () => {
      expect(adjustForInflation(0, 2011, 2021, table()).value).toBe(0);
    });

    it("the earliest and latest complete years can be converted between", () => {
      const t = table();
      expect(adjustForInflation(100, t.earliestCompleteYear!, t.latestCompleteYear!, t).value).toBeCloseTo(120, 10);
    });
  });

  describe("missing data", () => {
    it("a year with no CPI returns 'not adjusted', never a guess", () => {
      const result = adjustForInflation(1000, 1999, 2021, table());
      expect(result.status).toBe("not_adjusted");
      expect(result.value).toBeNull();
      expect(result.factor).toBeNull();
      expect(result.reason).toBe("No CPI is published for 1999 in the loaded data.");
    });

    it("a partial target year is not adjusted and says why", () => {
      const result = adjustForInflation(1000, 2011, 2026, table());
      expect(result.status).toBe("not_adjusted");
      expect(result.reason).toContain("9 of 12 months");
    });

    it("a partial starting year is not adjusted and says why", () => {
      expect(adjustForInflation(1000, 2015, 2021, table()).reason).toContain("11 of 12 months");
    });

    it("nothing is adjusted with an empty table", () => {
      expect(adjustForInflation(1000, 2011, 2021, buildCpiTable({ years: [] })).status).toBe("not_adjusted");
    });

    it.each([null, undefined])("a missing amount (%s) is not adjusted", (amount) => {
      const result = adjustForInflation(amount, 2011, 2021, table());
      expect(result.status).toBe("not_adjusted");
      expect(result.value).toBeNull();
      expect(result.original).toBeNull();
    });
  });

  describe("input validation", () => {
    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("does not convert the amount %s", (amount) => {
      const result = adjustForInflation(amount, 2011, 2021, table());
      expect(result.status).toBe("not_adjusted");
      expect(result.reason).toBe("There is no usable amount to convert.");
    });

    it("does not convert from an invalid year", () => {
      expect(adjustForInflation(1000, 2011.5, 2021, table()).reason).toBe("2011.5 is not a valid year.");
    });

    it("does not convert into an invalid year", () => {
      expect(adjustForInflation(1000, 2011, 3000, table()).reason).toBe("3000 is not a valid year.");
    });

    it("keeps the years it was given in the result", () => {
      const result = adjustForInflation(1000, 2011, 2026, table());
      expect(result.fromYear).toBe(2011);
      expect(result.toYear).toBe(2026);
    });
  });
});

// ------------------------------------------------------------------ inflationBetween and realChange

describe("inflationBetween", () => {
  it("prices rose 20% from 2011 to 2021", () => {
    expect(inflationBetween(2011, 2021, table())).toBeCloseTo(20, 10);
  });

  it("going backwards gives a negative percent", () => {
    expect(inflationBetween(2021, 2011, table())).toBeCloseTo(-16.6667, 3);
  });

  it("the same year is 0%", () => {
    expect(inflationBetween(2016, 2016, table())).toBe(0);
  });

  it.each([[2011, 2026], [1999, 2021], [2011, 2015]])("is unknown from %s to %s", (from, to) => {
    expect(inflationBetween(from, to, table())).toBeNull();
  });

  it("is unknown for an invalid year", () => {
    expect(inflationBetween(2011.5, 2021, table())).toBeNull();
  });
});

describe("realChange", () => {
  describe("normal cases", () => {
    it("rent rising 30% while prices rose 20% is about an 8.3% real rise", () => {
      const change = realChange(1000, 1300, 2011, 2021, table());
      expect(change.status).toBe("adjusted");
      expect(change.nominalPercent).toBeCloseTo(30, 10);
      expect(change.inflationPercent).toBeCloseTo(20, 10);
      expect(change.realPercent).toBeCloseTo(8.3333, 3);
      expect(change.fromValueAdjusted).toBeCloseTo(1200, 10);
      expect(change.reason).toBeNull();
    });

    it("rising exactly with inflation is no real change", () => {
      expect(realChange(1000, 1200, 2011, 2021, table()).realPercent).toBeCloseTo(0, 10);
    });

    it("rising slower than inflation is a real drop", () => {
      expect(realChange(1000, 1100, 2011, 2021, table()).realPercent!).toBeLessThan(0);
    });

    it("falling in published dollars is an even bigger real drop", () => {
      const change = realChange(1000, 900, 2011, 2021, table());
      expect(change.nominalPercent).toBeCloseTo(-10, 10);
      expect(change.realPercent).toBeCloseTo(-25, 10);
    });
  });

  describe("boundary cases", () => {
    it("the same year has equal nominal and real change", () => {
      const change = realChange(1000, 1100, 2016, 2016, table());
      expect(change.status).toBe("same_year");
      expect(change.realPercent).toBeCloseTo(change.nominalPercent!, 10);
      expect(change.inflationPercent).toBe(0);
    });

    it("a $0 starting value has no percent change and says so", () => {
      const change = realChange(0, 500, 2011, 2021, table());
      expect(change.nominalPercent).toBeNull();
      expect(change.realPercent).toBeNull();
      expect(change.reason).toBe("The starting value is $0, so there is no percent change.");
    });
  });

  describe("missing data", () => {
    it("a year without CPI keeps the nominal change and explains the rest", () => {
      const change = realChange(1000, 1300, 2011, 2026, table());
      expect(change.status).toBe("not_adjusted");
      expect(change.nominalPercent).toBeCloseTo(30, 10);
      expect(change.realPercent).toBeNull();
      expect(change.inflationPercent).toBeNull();
      expect(change.fromValueAdjusted).toBeNull();
      expect(change.reason).toContain("9 of 12 months");
    });
  });

  describe("input validation", () => {
    it.each([[-1, 100], [100, -1], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]])(
      "does not compare %s and %s",
      (from, to) => {
        const change = realChange(from, to, 2011, 2021, table());
        expect(change.status).toBe("not_adjusted");
        expect(change.nominalPercent).toBeNull();
        expect(change.reason).toBe("Both values must be usable amounts of $0 or more.");
      },
    );
  });
});

// ------------------------------------------------------------------ adjustSeries

describe("adjustSeries", () => {
  const series = [
    { year: 2011, value: 1000 },
    { year: 2016, value: 1100 },
    { year: 2021, value: 1300 },
  ];

  it("converts every point into the target year's dollars", () => {
    const result = adjustSeries(series, 2021, table());
    expect(result.map(p => p.adjustment.value)).toEqual([
      expect.closeTo(1200, 6),
      expect.closeTo(1200, 6),
      1300,
    ]);
  });

  it("keeps each original value beside the adjusted one", () => {
    const result = adjustSeries(series, 2021, table());
    expect(result.map(p => p.value)).toEqual([1000, 1100, 1300]);
    expect(result.map(p => p.year)).toEqual([2011, 2016, 2021]);
  });

  it("marks the point in the target year as the same year", () => {
    expect(adjustSeries(series, 2021, table())[2].adjustment.status).toBe("same_year");
  });

  it("leaves a missing value unconverted and keeps the rest", () => {
    const result = adjustSeries([{ year: 2011, value: null }, { year: 2016, value: 1100 }], 2021, table());
    expect(result[0].adjustment.status).toBe("not_adjusted");
    expect(result[1].adjustment.status).toBe("adjusted");
  });

  it("leaves every point unconverted when the target year has no CPI", () => {
    const result = adjustSeries(series, 2026, table());
    expect(result.every(p => p.adjustment.status === "not_adjusted")).toBe(true);
  });

  it("returns an empty list for an empty series", () => {
    expect(adjustSeries([], 2021, table())).toEqual([]);
  });

  it("keeps the order it was given", () => {
    const reversed = [...series].reverse();
    expect(adjustSeries(reversed, 2021, table()).map(p => p.year)).toEqual([2021, 2016, 2011]);
  });
});

// ------------------------------------------------------------------ labels and choices

describe("labels", () => {
  it("names adjusted, same-year and unadjusted dollars", () => {
    const t = table();
    expect(dollarLabel(adjustForInflation(1000, 2011, 2021, t))).toBe("Adjusted to 2021 dollars");
    expect(dollarLabel(adjustForInflation(1000, 2021, 2021, t))).toBe("2021 dollars");
    expect(dollarLabel(adjustForInflation(1000, 2011, 2026, t))).toBe("2011 dollars, not adjusted");
  });

  it("describes a real change in one sentence", () => {
    expect(describeRealChange(realChange(1000, 1300, 2011, 2021, table())))
      .toBe("2011 to 2021: up 30% as published, up 8.3% after inflation.");
  });

  it("describes a real drop", () => {
    expect(describeRealChange(realChange(1000, 1100, 2011, 2021, table())))
      .toBe("2011 to 2021: up 10% as published, down 8.3% after inflation.");
  });

  it("describes no change", () => {
    expect(describeRealChange(realChange(1000, 1200, 2011, 2021, table())))
      .toBe("2011 to 2021: up 20% as published, no change after inflation.");
  });

  it("describes a change that could not be adjusted, with the reason", () => {
    expect(describeRealChange(realChange(1000, 1300, 2011, 2026, table())))
      .toBe("2011 to 2026: up 30% as published. Not adjusted for inflation: 2026 has CPI for only 9 of 12 months, so it has no annual average yet.");
  });

  it("describes a same-year comparison", () => {
    expect(describeRealChange(realChange(1000, 1100, 2016, 2016, table())))
      .toBe("2016: up 10% as published; both values are from the same year.");
  });

  it("describes a $0 starting value", () => {
    expect(describeRealChange(realChange(0, 500, 2011, 2021, table())))
      .toBe("There is no percent change from a starting value of $0 (2011).");
  });

  it("uses a custom percent format when given one", () => {
    const text = describeRealChange(realChange(1000, 1300, 2011, 2021, table()), n => `${Math.abs(n).toFixed(2)} percent`);
    expect(text).toBe("2011 to 2021: up 30.00 percent as published, up 8.33 percent after inflation.");
  });

  it("has notes for adjusted and published dollars", () => {
    expect(ADJUSTMENT_NOTE).toContain("not a Toronto housing index");
    expect(NOMINAL_NOTE).toContain("not adjusted for inflation");
  });
});

describe("dollarBasisOptions", () => {
  it("always offers 'As published' first", () => {
    expect(dollarBasisOptions(table(), [])).toEqual([{ id: NOMINAL_BASIS, label: "As published", year: null }]);
  });

  it("adds each requested year that has CPI", () => {
    expect(dollarBasisOptions(table(), [2021, 2016]).map(o => o.label)).toEqual(["As published", "In 2021 dollars", "In 2016 dollars"]);
  });

  it("leaves out years without CPI", () => {
    expect(dollarBasisOptions(table(), [2026, 2015, 1999]).map(o => o.id)).toEqual([NOMINAL_BASIS]);
  });

  it("lists a repeated year once", () => {
    expect(dollarBasisOptions(table(), [2021, 2021]).map(o => o.id)).toEqual([NOMINAL_BASIS, "2021"]);
  });
});

// ------------------------------------------------------------------ loading from the backend

describe("isAnnualCpiResponse", () => {
  it("accepts the backend's response", () => {
    expect(isAnnualCpiResponse(RESPONSE)).toBe(true);
  });

  it.each([null, undefined, 42, "text", {}, { years: "nope" }])("rejects %s", (value) => {
    expect(isAnnualCpiResponse(value)).toBe(false);
  });

  it("rejects rows with the wrong shape", () => {
    expect(isAnnualCpiResponse({ years: [{ year: "2011", value: "100", status: "complete" }] })).toBe(false);
    expect(isAnnualCpiResponse({ years: [{ year: 2011, value: 100, status: "complete" }] })).toBe(false);
    expect(isAnnualCpiResponse({ years: [{ year: 2011, value: "100", status: "done" }] })).toBe(false);
    expect(isAnnualCpiResponse({ years: [null] })).toBe(false);
  });
});

describe("loadAnnualCpi", () => {
  beforeEach(() => clearCpiCache());
  afterEach(() => clearCpiCache());

  it("fetches the annual CPI from the backend and builds the table", async () => {
    const fetcher = fakeFetch(RESPONSE);
    const t = await loadAnnualCpi(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(CPI_ANNUAL_URL);
    expect(t.values.get(2021)).toBe(120);
  });

  it("fetches only once and reuses the result", async () => {
    const fetcher = fakeFetch(RESPONSE);
    await loadAnnualCpi(fetcher as unknown as typeof fetch);
    await loadAnnualCpi(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the cache is cleared", async () => {
    const fetcher = fakeFetch(RESPONSE);
    await loadAnnualCpi(fetcher as unknown as typeof fetch);
    clearCpiCache();
    await loadAnnualCpi(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when the backend has no CPI", async () => {
    await expect(loadAnnualCpi(fakeFetch({ error: "not loaded" }, 503) as unknown as typeof fetch))
      .rejects.toThrow("Could not load CPI for inflation adjustment (HTTP 503).");
  });

  it("fails clearly when the response has the wrong shape", async () => {
    await expect(loadAnnualCpi(fakeFetch({ rows: [] }) as unknown as typeof fetch))
      .rejects.toThrow("The CPI response was not in the expected format.");
  });

  it("does not keep a failure, so the next call tries again", async () => {
    await expect(loadAnnualCpi(fakeFetch({}, 500) as unknown as typeof fetch)).rejects.toThrow();
    const t = await loadAnnualCpi(fakeFetch(RESPONSE) as unknown as typeof fetch);
    expect(t.latestCompleteYear).toBe(2021);
  });
});

// ================================================================== deeper calculations

const LATEST = { value: "128.75", first_period: "2025-10", last_period: "2026-09", label: "the 12 months from 2025-10 to 2026-09" };
const tableWithLatest = (): CpiTable => buildCpiTable({ ...RESPONSE, latest_twelve_months: LATEST });

describe("latest twelve months", () => {
  describe("reading the backend block", () => {
    it("keeps a valid block", () => {
      expect(tableWithLatest().latestTwelveMonths).toEqual({
        value: 128.75, firstPeriod: "2025-10", lastPeriod: "2026-09", label: "the 12 months from 2025-10 to 2026-09",
      });
    });

    it("is null when the backend sends none", () => {
      expect(table().latestTwelveMonths).toBeNull();
      expect(buildCpiTable({ ...RESPONSE, latest_twelve_months: null }).latestTwelveMonths).toBeNull();
    });

    it.each(["0", "-1", "abc", "Infinity"])("ignores a block whose value is %s", (value) => {
      expect(buildCpiTable({ ...RESPONSE, latest_twelve_months: { ...LATEST, value } }).latestTwelveMonths).toBeNull();
    });

    it("ignores a block without its periods", () => {
      const broken = { ...LATEST, first_period: undefined } as unknown as typeof LATEST;
      expect(buildCpiTable({ ...RESPONSE, latest_twelve_months: broken }).latestTwelveMonths).toBeNull();
    });

    it("writes its own label when the backend sends none", () => {
      const noLabel = { ...LATEST, label: undefined } as unknown as typeof LATEST;
      expect(buildCpiTable({ ...RESPONSE, latest_twelve_months: noLabel }).latestTwelveMonths?.label)
        .toBe("the 12 months from 2025-10 to 2026-09");
    });
  });

  describe("adjustToLatestMonths", () => {
    it("converts a complete year into dollars of the latest twelve months", () => {
      const result = adjustToLatestMonths(1000, 2011, tableWithLatest());
      expect(result.status).toBe("adjusted");
      expect(result.value).toBeCloseTo(1287.5, 10);
      expect(result.toYear).toBe(2026);
      expect(result.period?.label).toBe("the 12 months from 2025-10 to 2026-09");
    });

    it("is not adjusted without the latest-months block", () => {
      const result = adjustToLatestMonths(1000, 2011, table());
      expect(result.status).toBe("not_adjusted");
      expect(result.reason).toBe("The loaded CPI does not have twelve consecutive recent months.");
      expect(result.toYear).toBe(2011);
    });

    it("is not adjusted from an incomplete year", () => {
      expect(adjustToLatestMonths(1000, 2015, tableWithLatest()).reason).toContain("11 of 12 months");
    });

    it.each([null, undefined, -1, Number.NaN])("does not convert the amount %s", (amount) => {
      expect(adjustToLatestMonths(amount, 2011, tableWithLatest()).reason).toBe("There is no usable amount to convert.");
    });
  });
});

describe("Census reference years", () => {
  it("income in a Census refers to the year before", () => {
    expect(censusReferenceYear(2021, "income")).toBe(2020);
    expect(censusReferenceYear(2021, "after_tax_income")).toBe(2020);
  });

  it("shelter cost and rent refer to the Census year", () => {
    expect(censusReferenceYear(2021, "shelter_cost")).toBe(2021);
    expect(censusReferenceYear(2016, "rent")).toBe(2016);
  });

  it("covers every measure with an offset of 0 or -1", () => {
    for (const offset of Object.values(CENSUS_REFERENCE_OFFSETS)) {
      expect([0, -1]).toContain(offset);
    }
  });

  it("adjusts income from its reference year", () => {
    const result = adjustCensusValue(1100, 2017, "income", 2021, table());
    expect(result.fromYear).toBe(2016);
    expect(result.value).toBeCloseTo(1200, 10);
  });

  it("adjusts shelter cost from the Census year", () => {
    expect(adjustCensusValue(1000, 2011, "shelter_cost", 2021, table()).value).toBeCloseTo(1200, 10);
  });

  it("does not adjust income whose reference year has no CPI", () => {
    const result = adjustCensusValue(1000, 2011, "income", 2021, table());
    expect(result.status).toBe("not_adjusted");
    expect(result.reason).toContain("2010");
  });
});

describe("annualizedInflation", () => {
  it("compounds: 20% over 10 years is about 1.84% a year", () => {
    expect(annualizedInflation(2011, 2021, table())).toBeCloseTo(1.8399, 3);
  });

  it("going back in time gives a negative rate", () => {
    expect(annualizedInflation(2021, 2011, table())).toBeCloseTo(-1.8067, 3);
  });

  it("the same year is 0", () => {
    expect(annualizedInflation(2016, 2016, table())).toBe(0);
  });

  it.each([[2011, 2026], [1999, 2021], [2011.5, 2021]])("is unknown from %s to %s", (from, to) => {
    expect(annualizedInflation(from, to, table())).toBeNull();
  });
});

describe("yearOverYear", () => {
  it("is unknown when the previous year is missing", () => {
    expect(yearOverYear(table()).map(r => r.inflationPercent)).toEqual([null, null, null]);
  });

  it("compares consecutive complete years", () => {
    const t = buildCpiTable({ years: [
      { year: 2020, value: "100", months_counted: 12, status: "complete" },
      { year: 2021, value: "103", months_counted: 12, status: "complete" },
      { year: 2022, value: "109.18", months_counted: 12, status: "complete" },
    ] });
    const rows = yearOverYear(t);
    expect(rows.map(r => r.year)).toEqual([2020, 2021, 2022]);
    expect(rows[0].inflationPercent).toBeNull();
    expect(rows[1].inflationPercent).toBeCloseTo(3, 10);
    expect(rows[2].inflationPercent).toBeCloseTo(6, 10);
    expect(rows[1].annualCpi).toBe(103);
  });

  it("is empty for an empty table", () => {
    expect(yearOverYear(buildCpiTable({ years: [] }))).toEqual([]);
  });
});

describe("rebaseCpi", () => {
  it("makes the base year 100", () => {
    const rebased = rebaseCpi(table(), 2011)!;
    expect(rebased.get(2011)).toBe(100);
    expect(rebased.get(2021)).toBeCloseTo(120, 10);
  });

  it("works with a later base year", () => {
    expect(rebaseCpi(table(), 2021)!.get(2011)).toBeCloseTo(83.3333, 3);
  });

  it("lists only complete years", () => {
    expect([...rebaseCpi(table(), 2016)!.keys()]).toEqual([2011, 2016, 2021]);
  });

  it("is null for a base year without CPI", () => {
    expect(rebaseCpi(table(), 2026)).toBeNull();
  });
});

describe("affordability over time", () => {
  describe("affordabilityPoint", () => {
    it("rent at 30% of income meets the guideline", () => {
      const point = affordabilityPoint({ year: 2021, monthlyRent: 1500, annualIncome: 60000 });
      expect(point.shareOfIncomePercent).toBeCloseTo(30, 10);
      expect(point.meetsGuideline).toBe(true);
    });

    it("the project plan example is over the guideline", () => {
      const point = affordabilityPoint({ year: 2021, monthlyRent: 2300, annualIncome: 72000 });
      expect(point.shareOfIncomePercent).toBeCloseTo(38.333, 2);
      expect(point.meetsGuideline).toBe(false);
    });

    it.each([
      [1000, 0], [1000, null], [null, 60000], [-1, 60000], [1000, Number.NaN],
    ])("has no share for rent %s and income %s", (monthlyRent, annualIncome) => {
      const point = affordabilityPoint({ year: 2021, monthlyRent, annualIncome });
      expect(point.shareOfIncomePercent).toBeNull();
      expect(point.meetsGuideline).toBeNull();
    });

    it("uses the 30% guideline", () => {
      expect(AFFORDABILITY_GUIDELINE_PERCENT).toBe(30);
    });
  });

  describe("affordabilityTrend", () => {
    it("rent taking a larger share of income", () => {
      const trend = affordabilityTrend([
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
        { year: 2021, monthlyRent: 1300, annualIncome: 72000 },
      ], table());
      expect(trend.shareChangePoints).toBeCloseTo(1.6667, 3);
      expect(trend.rentOutpacedIncome).toBe(true);
      expect(trend.rentChange?.realPercent).toBeCloseTo(8.3333, 3);
      expect(trend.incomeChange?.realPercent).toBeCloseTo(0, 10);
      expect(trend.summary).toBe("Rent took a larger share of income in 2021 than in 2011 (up 1.7 percentage points).");
    });

    it("rent taking a smaller share of income", () => {
      const trend = affordabilityTrend([
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
        { year: 2021, monthlyRent: 1100, annualIncome: 80000 },
      ], table());
      expect(trend.rentOutpacedIncome).toBe(false);
      expect(trend.summary).toContain("smaller share");
    });

    it("rent taking the same share of income", () => {
      const trend = affordabilityTrend([
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
        { year: 2021, monthlyRent: 1200, annualIncome: 72000 },
      ], table());
      expect(trend.summary).toBe("Rent took the same share of income in 2011 and 2021.");
    });

    it("sorts the points by year", () => {
      const trend = affordabilityTrend([
        { year: 2021, monthlyRent: 1300, annualIncome: 72000 },
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
      ], table());
      expect(trend.points.map(p => p.year)).toEqual([2011, 2021]);
      expect(trend.firstYear).toBe(2011);
      expect(trend.lastYear).toBe(2021);
    });

    it("compares the first and last years that have both rent and income", () => {
      const trend = affordabilityTrend([
        { year: 2006, monthlyRent: null, annualIncome: 50000 },
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
        { year: 2021, monthlyRent: 1300, annualIncome: 72000 },
      ], table());
      expect(trend.firstYear).toBe(2011);
      expect(trend.points).toHaveLength(3);
    });

    it("needs at least two usable years", () => {
      const trend = affordabilityTrend([{ year: 2011, monthlyRent: 1000, annualIncome: 60000 }], table());
      expect(trend.shareChangePoints).toBeNull();
      expect(trend.rentChange).toBeNull();
      expect(trend.firstYear).toBe(2011);
      expect(trend.summary).toBe("At least two years with both rent and income are needed to show a trend.");
    });

    it("an empty list has no trend", () => {
      const trend = affordabilityTrend([], table());
      expect(trend.firstYear).toBeNull();
      expect(trend.lastYear).toBeNull();
    });

    it("a year without CPI keeps the share but not the real change", () => {
      const trend = affordabilityTrend([
        { year: 2011, monthlyRent: 1000, annualIncome: 60000 },
        { year: 2026, monthlyRent: 1500, annualIncome: 80000 },
      ], table());
      expect(trend.shareChangePoints).not.toBeNull();
      expect(trend.rentChange?.realPercent).toBeNull();
      expect(trend.rentOutpacedIncome).toBe(true);
    });
  });
});

describe("applyDollarBasis", () => {
  const series = [
    { year: 2011, value: 1000 },
    { year: 2015, value: 1050 },
    { year: 2021, value: 1300 },
    { year: 2016, value: null },
  ];
  const nominal = { id: NOMINAL_BASIS, label: "As published", year: null };
  const in2021 = { id: "2021", label: "In 2021 dollars", year: 2021 };

  it("shows everything as published with the nominal basis", () => {
    const shown = applyDollarBasis(series, nominal, table());
    expect(shown.map(v => v.shown)).toEqual([1000, 1050, 1300, null]);
    expect(shown.every(v => !v.adjusted && v.note === null)).toBe(true);
    expect(shown[0].label).toBe("2011 dollars");
  });

  it("converts values with a year basis", () => {
    const shown = applyDollarBasis(series, in2021, table());
    expect(shown[0].shown).toBeCloseTo(1200, 10);
    expect(shown[0].adjusted).toBe(true);
    expect(shown[0].original).toBe(1000);
    expect(shown[0].label).toBe("Adjusted to 2021 dollars");
  });

  it("shows a value it cannot convert as published, with a note", () => {
    const shown = applyDollarBasis(series, in2021, table())[1];
    expect(shown.shown).toBe(1050);
    expect(shown.adjusted).toBe(false);
    expect(shown.note).toContain("11 of 12 months");
    expect(shown.label).toBe("2015 dollars, not adjusted");
  });

  it("keeps a missing value missing, without a note", () => {
    const shown = applyDollarBasis(series, in2021, table())[3];
    expect(shown.shown).toBeNull();
    expect(shown.note).toBeNull();
  });

  it("a value already in the basis year is shown unchanged and not marked adjusted", () => {
    const shown = applyDollarBasis(series, in2021, table())[2];
    expect(shown.shown).toBe(1300);
    expect(shown.adjusted).toBe(false);
    expect(shown.label).toBe("2021 dollars");
  });

  it("basisNote picks the CPI note only when something was adjusted", () => {
    expect(basisNote(applyDollarBasis(series, in2021, table()))).toBe(ADJUSTMENT_NOTE);
    expect(basisNote(applyDollarBasis(series, nominal, table()))).toBe(NOMINAL_NOTE);
    expect(basisNote([])).toBe(NOMINAL_NOTE);
  });
});
