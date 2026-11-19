import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayersPanel, type LayerGroup } from "./LayersPanel";

const groups = (population: boolean, schools: boolean): LayerGroup[] => [
  { title: "Colour the map by", counted: true, items: [{ id: "population", label: "Population", checked: population, onChange: () => {} }] },
  { title: "Nearby places", counted: true, items: [{ id: "school", label: "Schools", swatch: "#00f", checked: schools, onChange: () => {} }] },
  { title: "Map", items: [{ id: "3d", label: "3D buildings", checked: true, onChange: () => {} },
    { id: "historic", label: "Historic imagery", hint: "Not available yet", checked: false, onChange: () => {}, disabled: true }] },
];
const render = (g: LayerGroup[]) => renderToStaticMarkup(createElement(LayersPanel, { groups: g }));

describe("LayersPanel", () => {
  it("starts closed, with one button that counts only data layers", () => {
    const html = render(groups(true, true));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="2 data layers on">2</span>');
    expect(html).toMatch(/hidden="" role="group" aria-label="Map layers"/);
  });
  it("shows no count when only basemap settings are on", () => {
    expect(render(groups(false, false))).not.toContain("data layer");
  });
  it("groups labelled checkboxes, with a disabled layer marked as not available", () => {
    const html = render(groups(true, false));
    expect(html).toContain("<legend>Nearby places</legend>");
    expect(html).toMatch(/<input type="checkbox" checked=""\/><span><span[^>]*>Population<\/span>/);
    expect(html).toMatch(/<input type="checkbox" disabled=""\/><span><span[^>]*>Historic imagery<\/span><span[^>]*>Not available yet<\/span>/);
  });
});
