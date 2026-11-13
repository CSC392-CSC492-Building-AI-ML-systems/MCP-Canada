import { expect, it } from "vitest";
import { budgetStartingPoints } from "./recommendations";
import { comparisonHref, explorerHref, parsePlaces, parseProfile, type SearchProfile } from "./state";
import { explainEvidence } from "./Teacher";
const profile: SearchProfile = { version: 1, income: "72000", rent: "1500", bedrooms: "2", mode: "Transit", work: "", school: "", trip: 30, priorities: [1], weights: [5, 4, 5, 3, 4, 4], interests: [], notes: "private note" };
it("validates stored profiles instead of accepting incomplete or corrupt session data", () => {
  expect(parseProfile(JSON.stringify(profile))).toEqual(profile);
  expect(parseProfile('{')).toBeNull();
  expect(parseProfile(JSON.stringify({ ...profile, income: "NaN" }))).toBeNull();
  expect(parseProfile(JSON.stringify({ ...profile, weights: [99] }))).toBeNull();
});
it("filters missing costs, respects budget, and does not invent fit scores", () => {
  const rows = [{ geography_id: "a", name: "A", value: "1200", status: "observed", census_year: 2021, source_locator: "a" }, { geography_id: "b", name: "B", value: null, status: "missing", census_year: 2021, source_locator: "b" }, { geography_id: "c", name: "C", value: "1600", status: "observed", census_year: 2021, source_locator: "c" }];
  const results = budgetStartingPoints(rows, profile);
  expect(results.map(p => p.id)).toEqual(["a"]);
  expect(results[0].score).toBeNull();
  expect(budgetStartingPoints(rows, { ...profile, weights: [0, 5, 5, 5, 5, 5] })).toEqual([]);
  expect(budgetStartingPoints(rows, { ...profile, rent: "500" })[0].summary).toContain("above your budget");
});
it("never puts income, destinations or notes in navigation URLs", () => {
  const url = comparisonHref([{ id: "a", name: "A", year: 2021, boundary: "toronto-158" }], "recommended");
  expect(url).toContain("from=recommended");
  expect(url).not.toContain("income");
  expect(explorerHref({ geographyId: "a", year: 2011 }, true)).toBe("/housing/across-time/?neighbourhood=a&year=2011");
});
it("limits saved locations to five unique valid places", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `area${i}`, name: "Area", year: 2021, boundary: "toronto-158" }));
  expect(parsePlaces(JSON.stringify([...rows, rows[0]]))).toHaveLength(5);
  expect(parsePlaces(JSON.stringify([{ ...rows[0], boundary: "invented" }]))).toEqual([]);
});
it("the teacher explains limits and does not claim missing information is known", () => {
  expect(explainEvidence("How do data gaps affect comparisons?", null)).toContain("excluded, not estimated");
  expect(explainEvidence("Explain this history", null)).toContain("present-day imagery");
  expect(explainEvidence("Hello", null)).toContain("AI model is not connected");
});
