import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLandUse, type LandUse } from "@/lib/landUse";
import { LandUseKey } from "./LandUseLegend";

afterEach(() => vi.unstubAllGlobals());

const landUse: LandUse = {
  loaded: true, features: { type: "FeatureCollection", features: [] },
  shares: [{ category: "residential", label: "Residential", percent: 61.2 }, { category: "open_space", label: "Open space", percent: 18.4 }],
  notCoveredPercent: 20.4, asOf: "2026-11-19", source: { title: "Zoning By-law 569-2013 zoning areas", publisher: "City of Toronto" },
  parkSource: null,
};
const render = (result: Parameters<typeof LandUseKey>[0]["result"]) => renderToStaticMarkup(createElement(LandUseKey, { result }));

describe("LandUseKey", () => {
  it("shows each category's share of the neighbourhood and the land with no zone", () => {
    const html = render({ key: "k", landUse });
    expect(html).toContain("Residential<strong>61%</strong>");
    expect(html).toContain("Open space<strong>18%</strong>");
    expect(html).toContain("No zone in the file<strong>20%</strong>");
  });
  it("names unzoned City parks and their source, and shows a small share as <1%", () => {
    const html = render({ key: "k", landUse: { ...landUse, parkSource: { title: "Green Spaces", publisher: "City of Toronto" },
      shares: [...landUse.shares, { category: "unzoned_park", label: "City park, not in the zoning file", percent: 26.5 }, { category: "commercial", label: "Commercial", percent: 0.2 }] } });
    expect(html).toContain("City park, not in the zoning file<strong>27%</strong>");
    expect(html).toContain("Commercial<strong>&lt;1%</strong>");
    expect(html).toContain("Unzoned City parks: City of Toronto, Green Spaces.");
  });
  it("says zoning is permitted use, present day, not what was built or historical", () => {
    const html = render({ key: "k", landUse });
    expect(html).toContain("What land is zoned for, not what is built. Present day, not historical.");
    expect(html).toContain("City of Toronto, Zoning By-law 569-2013 zoning areas (amendments to June 2023), retrieved 2026-11-19");
  });
  it("tells not loaded, failure and loading apart", () => {
    expect(render({ key: "k", landUse: { ...landUse, loaded: false, shares: [], notCoveredPercent: null } })).toContain("not loaded in this database");
    expect(render({ key: "k", error: "Backend down" })).toContain("Zoning unavailable: Backend down");
    expect(render(undefined)).toContain("Loading zoning…");
  });
});

describe("loadLandUse", () => {
  it("asks for one neighbourhood and maps the response", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(new URL(input, "http://localhost"));
      return new Response(JSON.stringify({ category_loaded: true, features: landUse.features, shares: landUse.shares, not_covered_percent: 20.4, as_of: "2026-11-19", source: landUse.source, park_source: null }),
        { headers: { "content-type": "application/json" } });
    });
    expect(await loadLandUse("toronto-158-1")).toEqual(landUse);
    expect(calls[0].pathname).toBe("/api/land-use/");
    expect(calls[0].searchParams.get("geography_id")).toBe("toronto-158-1");
  });
});
