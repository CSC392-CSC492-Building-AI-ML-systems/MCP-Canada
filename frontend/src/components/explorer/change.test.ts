import { describe, expect, it } from "vitest";
import { formatPercent, MAJOR_CHANGE_PERCENT, measuredChange } from "./change";

describe("measuredChange", () => {
  it("reports absolute and percent change between two available years", () => {
    expect(measuredChange(20000, 25000)).toEqual({ from: 20000, to: 25000, absolute: 5000, percent: 25, major: true });
  });
  it("flags only changes at or above the agreed threshold", () => {
    expect(MAJOR_CHANGE_PERCENT).toBe(15);
    expect(measuredChange(100, 105)?.major).toBe(false);
    expect(measuredChange(100, 115)?.major).toBe(true);
    expect(measuredChange(100, 80)?.major).toBe(true);
  });
  it("never treats a missing value as zero", () => {
    expect(measuredChange(null, 25000)).toBeNull();
    expect(measuredChange(20000, null)).toBeNull();
  });
  it("has no percentage from a zero starting value", () => {
    expect(measuredChange(0, 10)).toEqual({ from: 0, to: 10, absolute: 10, percent: null, major: false });
  });
});

describe("formatPercent", () => {
  it("signs and rounds", () => {
    expect(formatPercent(25)).toBe("+25%");
    expect(formatPercent(-4.24)).toBe("−4.2%");
    expect(formatPercent(0)).toBe("0.0%");
  });
});
