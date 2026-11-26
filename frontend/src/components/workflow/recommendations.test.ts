import { describe, expect, it } from "vitest";
import type { PlaceExtras } from "./comparison-extras";
import { costById, rankByMatch, type Candidate, type CostRow } from "./recommendations";
import { scoreBreakdown } from "./scoring";
import type { SearchProfile } from "./state";

// Affordability (weight 5) and nearby amenities (weight 3) only.
const profile: SearchProfile = { version: 1, income: "", rent: "2000", mode: "Transit", work: "", school: "", trip: 30,
  priorities: [], weights: [5, 0, 0, 3, 0, 0], interests: [], notes: "" };
const noRanks = { libraries: null, schools: null, groceries: null, transitStops: null, dining: null, errands: null, childcare: null, culturalSpaces: null };
const empty: PlaceExtras = { population: null, childrenPct: null, seniorsPct: null, lowRisePct: null, immigrantPct: null, visibleMinorityPct: null,
  ...noRanks, ranks: noRanks, safety: null, safetyGap: null, parks: null, greenSharePct: null, greenRank: null };
const amenities = (rank: number): PlaceExtras => ({ ...empty, ranks: { ...noRanks, libraries: rank } });
const place = (id: string, cost: number | null, rank: number | null): Candidate =>
  ({ id, name: id, cost, extras: rank === null ? empty : amenities(rank) });

describe("rankByMatch", () => {
  it("orders by match score, not by cheapest rent", () => {
    // a: cheap but few amenities; b: a bit dearer, many amenities.
    const ranked = rankByMatch([place("a", 1000, 10), place("b", 1600, 90)], profile);
    expect(ranked.map(p => p.id)).toEqual(["b", "a"]);
    expect(ranked[0].score).toBe(scoreBreakdown(1600, amenities(90), profile)!.score);
  });

  it("gives each place exactly the score its own panel shows", () => {
    for (const c of [place("a", 2300, 40), place("b", null, 70)]) {
      const [ranked] = rankByMatch([c], profile);
      expect(ranked.breakdown).toEqual(scoreBreakdown(c.cost, c.extras, profile, {}));
    }
  });

  it("breaks ties by name, caps the list, and leaves out places with no score", () => {
    const tied = ["d", "c", "b", "a", "e", "f"].map(id => place(id, 1000, 50));
    expect(rankByMatch([...tied, place("none", null, null)], profile).map(p => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rankByMatch([place("none", null, null)], profile)).toEqual([]);
    expect(rankByMatch(tied, profile, 20)).toHaveLength(6);
  });

  it("summarises rent against the budget, trips over the limit and coverage", () => {
    const [over] = rankByMatch([place("a", 2300, 50)], profile);
    expect(over.summary).toBe("$2,300 / mo. · above your budget · 2 of 2 factors");
    const commuter = { ...profile, weights: [5, 4, 0, 0, 0, 0], workPoint: { lng: -79.38, lat: 43.65 } };
    const [far] = rankByMatch([{ ...place("b", 1500, null), trips: { work: 45 } }], commuter);
    expect(far.summary).toBe("$1,500 / mo. · within your budget · a trip is over your limit · 2 of 2 factors");
  });
});

describe("costById", () => {
  const row = (geography_id: string, value: string | null, overrides: Partial<CostRow> = {}): CostRow =>
    ({ geography_id, name: geography_id, value, status: "observed", census_year: 2021, source_locator: geography_id, ...overrides });
  it("keeps valid 2021 rents and turns missing, invalid, negative and other-year values into null, never 0", () => {
    const costs = costById([row("a", "1500"), row("b", null, { status: "suppressed" }), row("c", "abc"), row("d", "-5"), row("e", "900", { census_year: 2016 })]);
    expect(Object.fromEntries(costs)).toEqual({ a: 1500, b: null, c: null, d: null, e: null });
  });
});
