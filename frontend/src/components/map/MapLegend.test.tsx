import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BandKey } from "./MapLegend";
import { bandOf } from "@/lib/shading";

const key = { labels: ["Under 10k", "10k–20k", "20k and over"], colors: ["#a", "#b", "#c"], noData: "#n", noDataLabel: "No data" };

describe("BandKey", () => {
  it("states the selected neighbourhood's value and marks its band", () => {
    const html = renderToStaticMarkup(createElement(BandKey, { ...key, selected: { name: "Annex", text: "29,300 people", band: bandOf(29_300, [10_000, 20_000]) } }));
    expect(html).toContain("<strong>Annex</strong> · 29,300 people");
    expect(html).toMatch(/20k and over<em> ◂ Annex<\/em>/);
    expect(html.match(/◂/g)).toHaveLength(1);
  });
  it("marks no data, not the lowest band, when the value is unknown", () => {
    const html = renderToStaticMarkup(createElement(BandKey, { ...key, selected: { name: "Annex", text: "Population unknown", band: null } }));
    expect(html).toContain("Population unknown");
    expect(html).not.toContain("◂");
    expect(html).toMatch(/<li class="[^"]+"><span style="background:#n"><\/span>No data/);
  });
  it("is a plain key without a selection", () => {
    expect(renderToStaticMarkup(createElement(BandKey, key))).not.toContain("<strong>");
  });
});
