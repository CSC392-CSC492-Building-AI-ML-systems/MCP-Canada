import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AcrossTimePanel } from "./AcrossTimePanel";
import type { Measurement, NeighbourhoodProfile } from "./types";

const cost: Measurement = { value: "1200", status: "observed", reason: "", statistic: "average", unit: "CAD/month", reference_year: 2006, source: null };
const profile: NeighbourhoodProfile = {
  geography: { id: "fixture", name: "Test place", code: "1", boundary_set: "toronto-140", boundary_version: "140" },
  year: 2006, available_years: [2001, 2006, 2011, 2016],
  metrics: { cost, income: cost, burden: cost },
  history: [2001, 2006, 2011, 2016].map(year => ({ year, cost: year === 2001 ? { ...cost, value: null, status: "missing" } : cost })),
  method: { comparison: "Use the same boundary.", housing: "", income: "", inflation: "", release_selection: "" },
};
it("02C shows real available periods and keeps missing observations unavailable", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile, onCompare: () => {}, saved: false, limitReached: false }));
  expect(html).toContain("Compare across time");
  expect(html).toContain("Test place");
  expect(html).toContain("$1,200");
  expect(html).toContain("<td>—</td>");
  expect(html).not.toContain("Footprint");
  expect(html).not.toContain(">1950<");
});
it("does not imply a historical comparison exists when only 2021 is loaded", () => {
  const html = renderToStaticMarkup(createElement(AcrossTimePanel, { profile: { ...profile, available_years: [2021], history: [{ year: 2021, cost }] }, onCompare: () => {}, saved: true, limitReached: false }));
  expect(html).toContain("Only one Census period is loaded");
  expect(html).toContain("Added to compare");
  expect(html).not.toContain("Comparison period 2");
});
