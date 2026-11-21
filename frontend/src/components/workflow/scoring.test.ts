import { expect, it } from "vitest";
import type { PlaceExtras } from "./comparison-extras";
import { affordabilityScore, commuteCheck, explainScore, matchScore, scoreBreakdown, type Factor } from "./scoring";
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
  expect(f.commute).toMatchObject({ status: "scored", score: 100, detail: "20 min by transit, within your 40-minute limit" });
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

it("scores rent at 38% of income lower than rent at 30%, even when both fit the budget", () => {
  // Proposal case: $2,300 rent on $72,000 a year is 38% of the $6,000 monthly income.
  const high = affordabilityScore(2300, 4000, 72000);
  const guideline = affordabilityScore(1800, 4000, 72000);
  expect(Math.round(high.incomeSharePct!)).toBe(38);
  expect(high.meetsGuideline).toBe(false);
  expect(guideline).toMatchObject({ score: 100, incomeSharePct: 30, meetsGuideline: true });
  expect(high.score).toBeLessThan(guideline.score);
  expect(Math.round(high.score)).toBe(58); // (50 - 38.3) / 20
  expect(affordabilityScore(3000, 4000, 72000).score).toBe(0); // 50% of income
});

it("uses the budget alone when there is no income, and rent exactly at budget is within it", () => {
  expect(affordabilityScore(2000, 2000, null)).toEqual({ score: 50, withinBudget: true, incomeSharePct: null, meetsGuideline: null });
  // The lower part counts: within the 30% guideline but over budget still scores low.
  expect(affordabilityScore(2400, 2000, 120000).score).toBeCloseTo(10); // 24% of income, but 120% of budget
});

it("shows the income share and flags rent over 30% of income", () => {
  const b = scoreBreakdown(2300, empty, { ...profile, income: "72000", rent: "2500" })!;
  expect(b.factors[0]).toMatchObject({ status: "scored", score: 58, detail: "$2,300/mo, within your budget, but 38% of your monthly income (the guideline is 30% or less)" });
  expect(b.flags).toEqual(["over_income_guideline"]);
  expect(scoreBreakdown(1500, empty, { ...profile, income: "72000", rent: "2500" })!.factors[0])
    .toMatchObject({ detail: "$1,500/mo, within your budget, 25% of your monthly income" });
  expect(scoreBreakdown(2300, empty, { ...profile, income: "72000", rent: "2000" })!.factors[0])
    .toMatchObject({ detail: "$2,300/mo, $300 over your budget and 38% of your monthly income (the guideline is 30% or less)" });
  // A blank or invalid income is ignored, never treated as 0.
  expect(scoreBreakdown(2300, empty, { ...profile, income: " ", rent: "2500" })!.flags).toEqual([]);
});

it("checks each trip against the limit on its own, never the average", () => {
  // Proposal case: 20 and 55 minutes with a 40-minute limit average 37.5 but one is over.
  const result = commuteCheck({ work: 20, school: 55 }, 40);
  expect(result.anyOverLimit).toBe(true);
  expect(result.checks).toEqual([
    { trip: "work", minutes: 20, overLimit: false },
    { trip: "school", minutes: 55, overLimit: true },
  ]);
  expect(commuteCheck({ work: 40 }, 40, { work: true, school: false }).anyOverLimit).toBe(false); // exactly at the limit is fine
});

it("marks a trip with no travel time as unavailable, not within or over", () => {
  expect(commuteCheck({ work: null, school: 30 }, 40).checks[0]).toEqual({ trip: "work", minutes: null, overLimit: null });
  expect(commuteCheck({ work: 20 }, 40, { work: true, school: false }).checks).toHaveLength(1); // no school address: left out
});

it("flags a neighbourhood when either commute is over the limit", () => {
  const both = { ...profile, weights: [0, 4, 4, 0, 0, 0], workPoint: { lng: -79.38, lat: 43.65 }, schoolPoint: { lng: -79.4, lat: 43.7 } };
  const b = scoreBreakdown(null, empty, both, { work: 20, school: 55 })!;
  expect(b.flags).toEqual(["commute_over_limit"]);
  expect(b.trips.map(t => t.overLimit)).toEqual([false, true]);
  expect(byKey(b.factors).school).toMatchObject({ detail: "55 min by transit, over your 40-minute limit" });
  expect(scoreBreakdown(null, empty, both, { work: 20, school: 35 })!.flags).toEqual([]);
});

it("explains the score from its own factors: strongest, weakest, flags and gaps", () => {
  // affordability 100 × 5 = 500 helps most; amenities 60 × 3 costs 120; safety (weight 2) has no data.
  const b = scoreBreakdown(1500, ranked({ libraries: 60 }), profile)!;
  expect(explainScore(b)).toEqual([
    "Strongest: Affordability, 100/100 ($1,500/mo, within your budget).",
    "Held back most by: Nearby amenities, 60/100 (Ranks 60 of 100 for libraries, schools, groceries and transit stops nearby).",
    "Not included, because there is no data: Safety.",
    "Based on 2 of the 3 factors you weighted.",
  ]);
});

it("names the trade-off when a place is over budget or a trip is over the limit", () => {
  const both = { ...profile, weights: [5, 4, 4, 0, 0, 0], workPoint: { lng: -79.38, lat: 43.65 }, schoolPoint: { lng: -79.4, lat: 43.7 } };
  const lines = explainScore(scoreBreakdown(2300, empty, both, { work: 20, school: 55 })!);
  expect(lines[0]).toBe("Strongest: Commute to work, 100/100 (20 min by transit, within your 40-minute limit).");
  expect(lines).toContain("Rent is over your budget.");
  expect(lines).toContain("The school trip (55 min) is over your limit.");
});

it("never mentions weight-0 factors and says plainly when there is no score", () => {
  const lines = explainScore(scoreBreakdown(null, empty, profile)!);
  expect(lines[0]).toBe("There is no score for this neighbourhood: none of the factors you weighted have data here.");
  expect(lines.join(" ")).not.toMatch(/Commute|Lifestyle/); // both have weight 0 in this profile
  expect(lines).toContain("Not included, because there is no data: Affordability, Nearby amenities, Safety.");
});
