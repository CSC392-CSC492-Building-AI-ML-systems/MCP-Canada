import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NearbySnapshot } from "@/lib/nearbyStore";
import { EverydayNeedsTable, NeighbourhoodDetailsPanel } from "./NeighbourhoodDetailsPanel";
import type { Measurement, NeighbourhoodProfile } from "./types";

const m: Measurement = { value: "1376", status: "observed", reason: "", unit: "CAD/month", statistic: "average", reference_year: 2021, source: null };
const profile: NeighbourhoodProfile = {
  geography: { id: "toronto-158-1", name: "Test area", code: "1", boundary_set: "toronto-158", boundary_version: "158" },
  year: 2021, available_years: [2021], metrics: { cost: m, income: m, burden: m, population: m },
  history: [{ year: 2021, cost: m, income: m, burden: m, population: m }],
  method: { housing: "", comparison: "", income: "", inflation: "", release_selection: "" },
};
const snapshot: NonNullable<NearbySnapshot> = {
  geographyId: "toronto-158-1", originLabel: "the centre of Test area", asOf: "2026-10-27", routed: true,
  summaries: {
    school: { state: "ok", within: 4, nearest: { name: "Test Public School", straightMetres: 347, minutes: 6, metres: 450, estimated: false },
      ranked: [{ name: "Test Public School", straightMetres: 347, minutes: 6, metres: 450, estimated: false }, { name: "Second School", straightMetres: 500, minutes: 9, metres: 700, estimated: false }] },
    grocery: { state: "not_loaded" },
    transit_stop: { state: "loading" },
    library: { state: "ok", within: 0, nearest: { name: "Branch", straightMetres: 2300, minutes: 38, metres: 2300, estimated: true }, ranked: [] },
    park: { state: "ok", within: 3, nearest: { name: "High Park", straightMetres: 0, minutes: 0, metres: 0, estimated: false }, ranked: [] },
  },
};
const table = (s: NearbySnapshot, id = "toronto-158-1") => renderToStaticMarkup(createElement(EverydayNeedsTable, { geographyId: id, snapshot: s }));

describe("Everyday needs", () => {
  it("waits for the map instead of showing zeros", () => {
    const html = renderToStaticMarkup(createElement(NeighbourhoodDetailsPanel, { profile, income: "", budget: "", onIncomeChange: () => {}, onBudgetChange: () => {} }));
    expect(html).toContain("Nearby distances appear once the map has loaded this neighbourhood.");
  });
  it("shows the map's count, nearest distance and walking estimate", () => {
    const html = table(snapshot);
    // Street route: 450 m and 6 minutes along streets, not the 347 m straight line.
    expect(html).toContain('<td>4</td><td title="Test Public School (by street)">450 m</td><td>6 min</td>');
    // A real zero within 1 km is shown; a straight-line fallback is marked with ~.
    expect(html).toContain('<td>0</td><td title="Branch (straight-line estimate)">~2.3 km</td><td>~38 min</td>');
    expect(html).toContain("follow streets and paths");
    expect(html).toContain("as of 2026-10-27, not historical");
    expect(html).toContain("Walks start from the centre of Test area");
  });
  it("marks unloaded and loading rows unavailable rather than zero, and shows parks to their edge", () => {
    const html = table(snapshot);
    expect(html).toContain('title="Not loaded in this database"><th scope="row">Groceries</th><td>—</td>');
    expect(html).toContain('title="Loading"><th scope="row">Transit stops</th><td>—</td>');
    expect(html).toContain('<th scope="row">Parks</th><td>3</td><td title="High Park (by street)">Inside</td><td>0 min</td>');
    expect(html).toContain("their rows show a dash, not zero");
  });
  it("lists the closest walks for each kind under a collapsed section", () => {
    const html = table(snapshot);
    expect(html).toContain("<summary>Closest walks for each</summary>");
    expect(html).toContain("<h3>Schools</h3>");
    expect(html).toContain("<span>Second School</span><span>9 min walk · 700 m by street</span>");
  });
  it("ignores numbers calculated for a different neighbourhood", () => {
    expect(table(snapshot, "toronto-158-2")).toContain("Nearby distances appear once the map has loaded");
  });
});
