import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
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
