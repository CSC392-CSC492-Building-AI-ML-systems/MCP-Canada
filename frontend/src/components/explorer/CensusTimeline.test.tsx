import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CensusTimeline } from "./CensusTimeline";

it("keeps the timeline visible without inventing years before data loads", () => {
  const html = renderToStaticMarkup(createElement(CensusTimeline, { years: [], year: null, onYearChange: () => {} }));
  expect(html).toContain("Census data not loaded");
  expect(html).not.toContain('type="range"');
  expect(html).not.toContain("null Census");
});

it("exposes only the loaded Census years as discrete slider steps", () => {
  const html = renderToStaticMarkup(createElement(CensusTimeline, { years: [2001, 2006, 2011, 2016], year: 2011, onYearChange: () => {} }));
  expect(html).toContain('type="range"');
  expect(html).toContain('max="3"');
  expect(html).toContain('value="2"');
  expect(html).toContain('aria-valuetext="2011 Census"');
  expect(html).not.toContain(">2021<");
});

it("disables scrubbing when the boundary set has only one loaded year", () => {
  const html = renderToStaticMarkup(createElement(CensusTimeline, { years: [2021], year: 2021, onYearChange: () => {} }));
  expect(html).toContain('disabled=""');
  expect(html).toContain("2021 Census");
});
