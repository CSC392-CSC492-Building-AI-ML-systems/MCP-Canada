import { expect, it } from "vitest";
import { comparisonHref, explorerHref, parsePlaces, parseProfile, type SearchProfile } from "./state";
import { explainEvidence } from "./Teacher";
const profile: SearchProfile = { version: 1, income: "72000", rent: "1500", mode: "Transit", work: "", school: "", trip: 30, priorities: [1], weights: [5, 4, 5, 3, 4, 4], interests: [], notes: "private note" };
it("validates stored profiles instead of accepting incomplete or corrupt session data", () => {
  expect(parseProfile(JSON.stringify(profile))).toEqual(profile);
  expect(parseProfile(JSON.stringify({ ...profile, work: "Downtown Toronto", school: "Bloor West", notes: "Ready to move in" }))).toEqual({ ...profile, work: "Downtown Toronto", school: "Bloor West", notes: "Ready to move in" });
  expect(parseProfile('{')).toBeNull();
  expect(parseProfile(JSON.stringify({ ...profile, income: "NaN" }))).toBeNull();
  expect(parseProfile(JSON.stringify({ ...profile, trip: 200 }))).toBeNull();
  expect(parseProfile(JSON.stringify({ ...profile, weights: [99] }))).toBeNull();
});
it("rejects invalid rents, preference limits, and malformed preference values", () => {
  const invalidProfiles = [
    { ...profile, rent: "0" },
    { ...profile, trip: -1 },
    { ...profile, priorities: [0, 1, 2, 3] },
    { ...profile, priorities: [8] },
    { ...profile, weights: [1, 2] },
    { ...profile, interests: [1] },
  ];

  expect(invalidProfiles.map(value => parseProfile(JSON.stringify(value))))
    .toEqual(invalidProfiles.map(() => null));
});
it("never puts income, destinations or notes in navigation URLs", () => {
  const url = comparisonHref([{ id: "a", name: "A", year: 2021, boundary: "toronto-158" }], "recommended");
  expect(url).toContain("from=recommended");
  expect(url).not.toContain("income");
  expect(explorerHref({ geographyId: "a", year: 2011 }, true)).toBe("/housing/across-time/?neighbourhood=a&year=2011");
});
it("deduplicates and caps comparison URLs without including profile data", () => {
  const places = Array.from({ length: 7 }, (_, index) => ({
    id: `place ${index}`,
    name: `Area ${index}`,
    year: 2021,
    boundary: "toronto-158",
  }));
  const url = new URL(comparisonHref([places[0], ...places], "saved"), "https://example.org");

  expect(url.pathname).toBe("/housing/compare/");
  expect(url.searchParams.get("from")).toBe("saved");
  expect(url.searchParams.get("places")?.split(",")).toEqual(places.slice(0, 5).map(place => place.id));
  expect(url.searchParams.has("income")).toBe(false);
  expect(explorerHref(null)).toBe("/housing/");
  expect(explorerHref(null, true)).toBe("/housing/across-time/");
});
it("limits saved locations to five unique valid places", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `area${i}`, name: "Area", year: 2021, boundary: "toronto-158" }));
  expect(parsePlaces(JSON.stringify([...rows, rows[0]]))).toHaveLength(5);
  expect(parsePlaces(JSON.stringify([{ ...rows[0], boundary: "invented" }]))).toEqual([]);
  expect(parsePlaces("not-json")).toEqual([]);
  expect(parsePlaces(JSON.stringify([null, {}, { ...rows[0], year: "2021" }]))).toEqual([]);
});
it("the teacher explains limits and does not claim missing information is known", () => {
  expect(explainEvidence("How do data gaps affect comparisons?", null)).toContain("excluded, not estimated");
  expect(explainEvidence("Explain this history", null)).toContain("present-day imagery");
  expect(explainEvidence("Hello", null)).toContain("AI model is not connected");
});
