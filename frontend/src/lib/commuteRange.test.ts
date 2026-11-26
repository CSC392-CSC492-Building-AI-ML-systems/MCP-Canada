import { describe, expect, it } from "vitest";
import { commuteBands, commuteShading, COMMUTE_COLORS } from "./commuteRange";
import { shadingColor } from "./shading";

/** The band Mapbox's "step" expression picks for a value. */
function band(value: number, breaks: number[]) {
  return breaks.filter(b => value >= b).length;
}

describe("commute bands", () => {
  it("follow the match score: half the limit, the limit and 1.5 times it", () => {
    expect(commuteBands(40)).toEqual({ breaks: [20, 40, 60], labels: ["Up to 20 min", "20–40 min (your limit)", "40–60 min", "Over 60 min"] });
  });
  it("use 15-minute steps when the profile has no trip limit", () => {
    expect(commuteBands(0).breaks).toEqual([15, 30, 45]);
  });
  it("count a trip exactly at the limit as within it", () => {
    const { breaks } = commuteShading({}, 40, "work");
    expect(band(20, breaks)).toBe(0);
    expect(band(21, breaks)).toBe(1);
    expect(band(40, breaks)).toBe(1);
    expect(band(41, breaks)).toBe(2);
    expect(band(61, breaks)).toBe(3);
  });
  it("describes a missing trip as unknown, never as a time", () => {
    const shading = commuteShading({ a: 12, b: null }, 40, "school");
    expect(shading.describe(12)).toBe("12 min to school");
    expect(shading.describe(null)).toBe("No school time");
    expect(shading.colors).toEqual(COMMUTE_COLORS);
  });
});

describe("shadingColor", () => {
  it("colours by band and leaves features without a value as no data", () => {
    expect(shadingColor({ breaks: [10, 20], colors: ["#111", "#222", "#333"], noData: "#999" }))
      .toEqual(["case", ["has", "shade_value"], ["step", ["get", "shade_value"], "#111", 10, "#222", 20, "#333"], "#999"]);
  });
});
