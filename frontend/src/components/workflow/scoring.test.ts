import { expect, it } from "vitest";
import type { PlaceExtras } from "./comparison-extras";
import { matchScore, scoreBreakdown, type Factor } from "./scoring";
import type { SearchProfile } from "./state";

const profile: SearchProfile = { version: 1, income: "", rent: "2000", mode: "Transit", work: "", school: "", trip: 40,
  priorities: [1], weights: [5, 0, 0, 3, 2, 0], interests: [], notes: "" };
const noRanks = { libraries: null, schools: null, groceries: null, transitStops: null, dining: null, errands: null, childcare: null, culturalSpaces: null };
const empty: PlaceExtras = { population: null, childrenPct: null, seniorsPct: null, lowRisePct: null, immigrantPct: null, visibleMinorityPct: null,
  ...noRanks, ranks: noRanks, safety: null, safetyGap: null, parks: null, greenSharePct: null, greenRank: null };
const ranked = (ranks: Partial<PlaceExtras["ranks"]>): PlaceExtras => ({ ...empty, ranks: { ...noRanks, ...ranks } });
const byKey = (factors: Factor[]) => Object.fromEntries(factors.map(f => [f.key, f]));

it("lists all six factors: scored, unavailable with a reason, or off at weight 0", () => {
  const b = scoreBreakdown(1500, { ...ranked({ libraries: 60 }), safetyGap: "No police data for 2021" }, profile)!;
  const f = byKey(b.factors);
  expect(b.factors.map(x => x.key)).toEqual(["affordability", "commute", "school", "amenities", "safety", "lifestyle"]);
  expect(f.affordability).toMatchObject({ status: "scored", score: 100, detail: "$1,500/mo, within your budget" });
  expect(f.amenities).toMatchObject({ status: "scored", score: 60 });
  expect(f.safety).toEqual({ key: "safety", label: "Safety", weight: 2, status: "unavailable", reason: "No police data for 2021" });
  expect(f.commute.status).toBe("off");
  expect(f.lifestyle.status).toBe("off");
});

it("leaves unavailable factors out and rebalances the remaining weights, never counting them as 0", () => {
  // affordability 100 (weight 5) and amenities 60 (weight 3); safety (weight 2) has no data.
  const b = scoreBreakdown(1500, ranked({ libraries: 60 }), profile)!;
  expect(b.score).toBe(Math.round((5 * 100 + 3 * 60) / 8)); // 85, not (500 + 180 + 0) / 10 = 68
  expect(b.coverage).toEqual({ used: 2, weighted: 3 });
});

it("gives no score when nothing weighted has data", () => {
  const b = scoreBreakdown(null, empty, profile)!;
  expect(b.score).toBeNull();
  expect(b.coverage).toEqual({ used: 0, weighted: 3 });
  expect(byKey(b.factors).affordability).toMatchObject({ status: "unavailable", reason: "No published rent for this neighbourhood" });
  expect(scoreBreakdown(1500, empty, null)).toBeNull();
});

it("flags rent over budget and says by how much", () => {
  const b = scoreBreakdown(2300, empty, profile)!;
  expect(b.flags).toEqual(["over_budget"]);
  expect(byKey(b.factors).affordability).toMatchObject({ detail: "$2,300/mo, $300 over your budget" });
  expect(scoreBreakdown(2000, empty, profile)!.flags).toEqual([]); // exactly at budget is within it
});

it("explains why a weighted trip is unavailable", () => {
  const trips = { ...profile, weights: [0, 4, 4, 0, 0, 0] };
  const noAddress = byKey(scoreBreakdown(null, empty, trips)!.factors);
  expect(noAddress.commute).toMatchObject({ status: "unavailable", reason: "No work address in your profile" });
  const withAddress = { ...trips, workPoint: { lng: -79.38, lat: 43.65 }, schoolPoint: { lng: -79.4, lat: 43.7 } };
  const f = byKey(scoreBreakdown(null, empty, withAddress, { work: 20, school: null })!.factors);
  expect(f.commute).toMatchObject({ status: "scored", score: 100, detail: "20 min by transit (your limit is 40 min)" });
  expect(f.school).toMatchObject({ status: "unavailable", reason: "No travel time for this neighbourhood" });
});

it("lists lifestyle priorities that have no data", () => {
  const lifestyle = { ...profile, weights: [0, 0, 0, 0, 0, 5], priorities: [1, 3] };
  const f = byKey(scoreBreakdown(null, ranked({ transitStops: 70 }), lifestyle)!.factors);
  expect(f.lifestyle).toMatchObject({ status: "scored", score: 70, detail: "Scored: Transit access. No data: Restaurants & nightlife" });
  expect(byKey(scoreBreakdown(null, empty, { ...lifestyle, priorities: [] })!.factors).lifestyle)
    .toMatchObject({ status: "unavailable", reason: "No lifestyle priorities chosen in your profile" });
});

it("matchScore stays the short form of the breakdown", () => {
  const extras = ranked({ libraries: 60 });
  expect(matchScore(1500, extras, profile)).toEqual({ score: scoreBreakdown(1500, extras, profile)!.score, covers: ["affordability", "amenities"] });
  expect(matchScore(null, empty, profile)).toBeNull();
});
