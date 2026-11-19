import { describe, expect, it, vi } from "vitest";
vi.mock("mapbox-gl", () => ({ default: {} }));
const { hoverText } = await import("./MapView");

describe("hoverText: one label, never stacked", () => {
  const area = { name: "Pelmo Park-Humberlea", population: 10_000, shaded: true };
  const park = { name: "PELLATT PARK", metres: 420 };
  const school = { name: "Test School", label: "Schools", metres: 350 };
  it("shows the amenity point over the park and the neighbourhood", () => {
    expect(hoverText(school, park, area)).toBe("Test School (Schools) · 350 m straight line, ~6 min walk (estimate)");
  });
  it("uses the street walk when the point has one", () => {
    expect(hoverText({ ...school, walk_minutes: 7, walk_metres: 480 }, park, area)).toBe("Test School (Schools) · 7 min walk, 480 m by street");
  });
  it("shows the park over the neighbourhood it sits in", () => {
    expect(hoverText(undefined, park, area)).toBe("Pellatt Park (park) · 420 m to its edge");
    expect(hoverText(undefined, { name: "HIGH PARK", metres: 0 }, area)).toBe("High Park (park) · distances are measured from inside it");
  });
  it("shows the zone over the neighbourhood, under parks and points", () => {
    const zone = { label: "Residential apartment", zone: "RA (d2.5)" };
    expect(hoverText(undefined, undefined, area, zone)).toBe("Zoned residential apartment (RA (d2.5))");
    expect(hoverText(undefined, park, area, zone)).toBe("Pellatt Park (park) · 420 m to its edge");
    expect(hoverText(undefined, undefined, area, { category: "unzoned_park", label: "City park, not in the zoning file" })).toBe("City park, not in the zoning file (City park)");
  });
  it("falls back to the neighbourhood, then to no label", () => {
    expect(hoverText(undefined, undefined, area)).toBe("Pelmo Park-Humberlea · 10,000 people");
    expect(hoverText(undefined, undefined, { name: "Annex" })).toBe("Annex");
    expect(hoverText(undefined, undefined, undefined)).toBeNull();
  });
});
