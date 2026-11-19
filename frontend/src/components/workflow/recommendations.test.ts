import { describe, expect, it } from "vitest";
import { budgetStartingPoints, type CostRow } from "./recommendations";
import type { SearchProfile } from "./state";

const profile: SearchProfile = {
  version: 1,
  income: "",
  rent: "1500",
  mode: "Transit",
  work: "",
  school: "",
  trip: 30,
  priorities: [],
  weights: [5, 3, 3, 3, 3, 3],
  interests: [],
  notes: "",
};

function row(
  geography_id: string,
  name: string,
  value: string | null,
  overrides: Partial<CostRow> = {},
): CostRow {
  return {
    geography_id,
    name,
    value,
    status: "observed",
    census_year: 2021,
    source_locator: geography_id,
    ...overrides,
  };
}

describe("budgetStartingPoints", () => {
  it("orders eligible places by cost, breaks ties by name, and caps results at five", () => {
    const rows = [
      row("f", "Foxtrot", "1400"),
      row("d", "Delta", "1200"),
      row("c", "Charlie", "1200"),
      row("a", "Alpha", "1000"),
      row("b", "Bravo", "1100"),
      row("e", "Echo", "1300"),
    ];

    const results = budgetStartingPoints(rows, profile);

    expect(results.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(results.every(({ year, boundary, score }) =>
      year === 2021 && boundary === "toronto-158" && score === null,
    )).toBe(true);
    expect(results[0].summary).toContain("within your budget");
  });

  it("falls back to the cheapest available benchmarks when none fit the budget", () => {
    const results = budgetStartingPoints([
      row("expensive", "Expensive", "2100"),
      row("cheaper", "Cheaper", "1800"),
    ], { ...profile, rent: "1000" });

    expect(results.map(({ id }) => id)).toEqual(["cheaper", "expensive"]);
    expect(results.every(({ summary }) => summary?.includes("above your budget"))).toBe(true);
  });

  it("excludes missing, invalid, negative, and non-2021 observations", () => {
    const results = budgetStartingPoints([
      row("valid", "Valid", "1200"),
      row("missing", "Missing", null, { status: "missing" }),
      row("suppressed", "Suppressed", "900", { status: "suppressed" }),
      row("invalid", "Invalid", "not-a-number"),
      row("negative", "Negative", "-1"),
      row("old", "Old", "800", { census_year: 2016 }),
    ], profile);

    expect(results.map(({ id }) => id)).toEqual(["valid"]);
  });

  it("does not return starting points when affordability has zero weight", () => {
    expect(budgetStartingPoints(
      [row("valid", "Valid", "1200")],
      { ...profile, weights: [0, 5, 5, 5, 5, 5] },
    )).toEqual([]);
  });
});
