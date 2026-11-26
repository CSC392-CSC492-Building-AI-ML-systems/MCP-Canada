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
