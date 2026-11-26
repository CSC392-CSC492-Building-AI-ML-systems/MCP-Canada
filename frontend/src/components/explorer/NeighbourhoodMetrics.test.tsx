import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NeighbourhoodMetrics } from "./NeighbourhoodMetrics";
import type { PlaceExtras } from "../workflow/comparison-extras";

it("preserves a suppressed Census population as unavailable", () => {
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2011, loading: false, sources: [],
    population: { value: null, status: "suppressed", source: null, reason: "" },
  }));
  expect(html).toContain("<dt>Population</dt><dd>Unavailable</dd>");
  expect(html).not.toContain("<dd>0</dd>");
});
it("labels the police reference year and preserves actual zero park counts", () => {
  const extras = { parks: 0, greenSharePct: 0, safety: { rate: 1234, year: 2021, cityMedian: 1000, saferThanPct: 20 } } as PlaceExtras;
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2021, loading: false, extras, sources: [],
    population: { value: "10000", status: "observed", source: null, reason: "" },
  }));
  expect(html).toContain("10,000");
  expect(html).toContain("<dd>0</dd>");
  expect(html).toContain("1,234");
  expect(html).toContain("Toronto Police");
  expect(html).toContain("2021");
});

it("shows loading feedback instead of stale demographic and police values", () => {
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2021, loading: true, sources: [],
    extras: { childrenPct: 12.3, safety: { rate: 9876, year: 2021, cityMedian: 1000, saferThanPct: 20 } } as PlaceExtras,
    population: { value: "12345", status: "observed", source: null, reason: "" },
  }));
  expect(html).toContain("12,345");
  expect(html).toContain("Loading…");
  expect(html).toContain('role="status"');
  expect(html).toContain("Loading published police rates");
  expect(html).not.toContain("12.3%");
  expect(html).not.toContain("9,876");
});

it.each(["NaN", "Infinity"])("does not display a non-finite population %s", value => {
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2021, loading: false, sources: [],
    population: { value, status: "observed", source: null, reason: "" },
  }));
  expect(html).toContain("<dt>Population</dt><dd>Unavailable</dd>");
});

it("formats shares and displays the published source with a safe external link", () => {
  const source = { id: "census-2021", title: "Census profile", publisher: "Statistics Canada", url: "https://example.com/census", coverage: "Toronto" };
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2021, loading: false, sources: [source],
    extras: { childrenPct: 12.345, seniorsPct: 20, immigrantPct: 30.15, lowRisePct: 40.7, parks: 4, greenSharePct: 15.25 } as PlaceExtras,
    population: { value: "1000", status: "observed", source, reason: "" },
  }));
  expect(html).toContain("12.3%");
  expect(html).toContain("20%");
  expect(html).toContain("40.7%");
  expect(html).toContain("15.3%");
  expect(html).toContain("Neighbourhood metric sources");
  expect(html).toContain('href="https://example.com/census" target="_blank" rel="noreferrer"');
  expect(html).toContain("Statistics Canada");
});

it("explains a year or boundary coverage gap supplied by the data loader", () => {
  const reason = "Area changed in 2021; no matching police neighbourhood";
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2011, loading: false, sources: [],
    extras: { safety: null, safetyGap: reason } as PlaceExtras,
    population: { value: "123", status: "observed", source: null, reason: "" },
  }));
  expect(html).toContain(reason);
  expect(html).not.toContain("Combined major-crime rate");
  expect(html).not.toContain("Neighbourhood metric sources");
});

it("explains an unavailable police response even without a specific reason", () => {
  const html = renderToStaticMarkup(createElement(NeighbourhoodMetrics, {
    year: 2001, loading: false, sources: [],
    population: { value: null, status: "missing", source: null, reason: "" },
  }));
  expect(html).toContain("Police rates could not be loaded for this neighbourhood and year.");
  expect(html).toContain("2001");
});
