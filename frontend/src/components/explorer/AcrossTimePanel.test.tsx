import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildCpiTable, NOMINAL_NOTE } from "@/lib/inflation";
import { AcrossTimePanel } from "./AcrossTimePanel";
import type { Measurement, NeighbourhoodProfile } from "./types";

const cost: Measurement = { value: "1200", status: "observed", reason: "", statistic: "average", unit: "CAD/month", reference_year: 2006, source: null };
const profile: NeighbourhoodProfile = {
  geography: { id: "fixture", name: "Test place", code: "1", boundary_set: "toronto-140", boundary_version: "140" },
  year: 2006, available_years: [2001, 2006, 2011, 2016],
  metrics: { cost, income: cost, burden: cost, population: cost },
  history: [2001, 2006, 2011, 2016].map(year => {
    const value = year === 2001 ? { ...cost, value: null, status: "missing" } : year === 2016 ? { ...cost, value: "1500" } : cost;
    return { year, cost: value, income: value, burden: value, population: value };
  }),
  method: { comparison: "Use the same boundary.", housing: "", income: "", inflation: "", release_selection: "" },
};
it("02C shows real available periods and keeps missing observations unavailable", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile, onCompare: () => {}, saved: false, limitReached: false }));
  expect(html).toContain("Compare across time");
  expect(html).toContain("Test place");
  expect(html).toContain("$1,200");
  expect(html).toContain(">—</td>");
  expect(html).not.toContain("Footprint");
  expect(html).not.toContain(">1950<");
});
it("does not imply a historical comparison exists when only 2021 is loaded", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: { ...profile, available_years: [2021], history: [{ year: 2021, cost, income: cost, burden: cost, population: cost }] }, onCompare: () => {}, saved: true, limitReached: false }));
  expect(html).toContain("Only one Census period is available");
  expect(html).not.toContain("What changed");
  expect(html).toContain("Added to compare");
  expect(html).not.toContain("Comparison period 2");
});
it("summarises measured change between the first and last period and marks major changes", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: { ...profile, available_years: [2006, 2011, 2016] }, onCompare: () => {}, saved: false, limitReached: false }));
  expect(html).toContain("What changed, 2006–2016");
  expect(html).toContain("$1,200 → $1,500 (+$300, +25%)");
  expect(html).toContain("Major change");
  expect(html).toContain("does not show what caused it");
});
it("explains a gap instead of computing a change from a missing period", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: { ...profile, available_years: [2001, 2011] }, onCompare: () => {}, saved: false, limitReached: false }));
  expect(html).toContain("not comparable — the 2001 value is unavailable");
  expect(html).not.toContain("Major change");
});
it("marks values combined from 2021 neighbourhoods and shows the boundary change", () => {
  const combined = { ...cost, value: "1952.62", derived: { relation: "combined" as const, method: "Average of the 2021 values for its parts.", parts: ["A", "B"] } };
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: { ...profile, boundary_note: "In 2021 the City split this neighbourhood into A, B.",
    available_years: [2011, 2021], history: [{ year: 2011, cost, income: cost, burden: cost, population: cost }, { year: 2021, cost: combined, income: cost, burden: cost, population: cost }] }, onCompare: () => {}, saved: false, limitReached: false }));
  expect(html).toContain("BOUNDARY CHANGED IN 2021");
  expect(html).toContain("<sup");
  expect(html).toContain("* Average of the 2021 values for its parts.");
});

describe("dollar toggle", () => {
  // CPI 100 in 2010, 110 in 2011, 120 in 2020, 132 in 2021: 2011 → 2021 prices rose 20%.
  const cpi = buildCpiTable({ years: [[2010, "100"], [2011, "110"], [2020, "120"], [2021, "132"]].map(([year, value]) => ({ year: Number(year), value: String(value), months_counted: 12, status: "complete" as const })) });
  const measure = (value: string, reference_year: number): Measurement => ({ ...cost, value, reference_year });
  const twoPeriods: NeighbourhoodProfile = { ...profile, available_years: [2011, 2021], history: [
    { year: 2011, cost: measure("1000", 2011), income: measure("50000", 2010), burden: cost, population: { ...cost, value: "9000", unit: "people" } },
    { year: 2021, cost: measure("1500", 2021), income: measure("66000", 2020), burden: cost, population: { ...cost, value: "9500", unit: "people" } },
  ] };
  const render = (extra: object) => renderToStaticMarkup(createElement(AcrossTimePanel, { profile: twoPeriods, onCompare: () => {}, saved: false, limitReached: false, cpi, ...extra }));

  it("starts as published and offers the latest Census year's dollars", () => {
    const html = render({});
    expect(html).toContain('aria-pressed="true">As published');
    expect(html).toContain("In 2021 dollars");
    expect(html).toContain("$1,000 → $1,500 (+$500, +50%)");
    expect(html).toContain(NOMINAL_NOTE);
  });

  it("converts rent from the Census year and income from the year before, but not population", () => {
    const html = render({ dollarBasis: "2021" });
    expect(html).toContain("$1,200 → $1,500 (+$300, +25%)"); // 1000 × 132/110
    // Income is from 2010 and 2020: 50000 × 132/100 and 66000 × 132/120.
    expect(html).toContain("$66,000 → $72,600 (+$6,600, +10%)");
    expect(html).toContain(">9,000<");
    expect(html).toContain("national general inflation, not a Toronto housing index"); // ADJUSTMENT_NOTE
  });

  it("says when a year cannot be adjusted instead of comparing mixed dollars", () => {
    const gap = { ...twoPeriods, history: twoPeriods.history.map(h => h.year === 2011 ? { ...h, cost: measure("1000", 2009) } : h) };
    const html = render({ profile: gap, dollarBasis: "2021" });
    expect(html).toContain("not comparable — the 2011 value could not be adjusted for inflation");
    expect(html).toContain("$1,000"); // shown as published, never guessed
  });

  it("leaves the toggle out without CPI", () => {
    const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: twoPeriods, onCompare: () => {}, saved: false, limitReached: false }));
    expect(html).not.toContain("In 2021 dollars");
    expect(html).toContain(NOMINAL_NOTE);
  });
});
