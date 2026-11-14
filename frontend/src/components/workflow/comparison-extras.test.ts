import { afterEach, expect, it, vi } from "vitest";
import type { Catalog } from "../explorer/data";
import type { NeighbourhoodProfile } from "../explorer/types";
import { lifestyleMatch, matchScore, neighbourhoodMeasures, percentRank, rankAll, rankSafety, type PlaceExtras } from "./comparison-extras";
import type { SearchProfile } from "./state";

const profile: SearchProfile = { version: 1, income: "72000", rent: "1500", bedrooms: "2", mode: "Transit", work: "", school: "", trip: 30, priorities: [1], weights: [0, 0, 0, 5, 5, 0], interests: [], notes: "" };
const noRanks = { libraries: null, schools: null, groceries: null, transitStops: null };
const empty: PlaceExtras = { population: null, childrenPct: null, seniorsPct: null, libraries: null, schools: null, groceries: null, transitStops: null, ranks: noRanks, safety: null, safetyGap: null, parks: null, greenSharePct: null, greenRank: null };
const ranked = (ranks: Partial<PlaceExtras["ranks"]>): PlaceExtras => ({ ...empty, ranks: { ...noRanks, ...ranks } });

afterEach(() => { vi.unstubAllGlobals(); });

it("ranks safety against every neighbourhood and reports the city median", () => {
  const rates = new Map([["a", 100], ["b", 200], ["c", 300], ["d", 400]]);
  expect(rankSafety(rates, "b", 2021)).toEqual({ rate: 200, year: 2021, cityMedian: 250, saferThanPct: 50 });
  expect(rankSafety(rates, "d", 2021)?.saferThanPct).toBe(0);
  expect(rankSafety(rates, "missing", 2021)).toBeNull();
});

it("percentile ranks run 0–100 and give ties the same middle rank", () => {
  expect([10, 20, 30, 40, 50].map(v => percentRank([10, 20, 30, 40, 50], v))).toEqual([0, 25, 50, 75, 100]);
  expect(percentRank([1, 2, 2, 3], 2)).toBe(50);          // tied pair shares the middle
  expect(percentRank([5, 5, 5], 5)).toBe(50);              // all equal: nobody is better
  expect(percentRank([0, 0, 0, 7], 0)).toBe(33);           // a tie at the bottom does not reach 0 for one and 67 for another
  expect(percentRank([10], 10)).toBeNull();                // one value cannot be ranked
  // An extreme value is only "the highest", not a bigger score than any other top value.
  expect(percentRank([1, 2, 3, 1000], 1000)).toBe(percentRank([1, 2, 3, 4], 4));
});

it("ranks only the areas that have values, so a missing value is never ranked or counted as zero", () => {
  const ranks = rankAll(new Map([["a", 1], ["b", 3], ["c", 2]]));
  expect(Object.fromEntries(ranks)).toEqual({ a: 0, c: 50, b: 100 });
  expect(ranks.has("missing")).toBe(false);
});

it("scores amenities as the mean of the available density ranks and safety from its rank", () => {
  const extras = { ...ranked({ libraries: 80, groceries: 20 }), safety: { rate: 1, year: 2021, cityMedian: 2, saferThanPct: 70 } };
  // amenities = mean(80, 20) = 50; safety = 70; equal weights → 60
  expect(matchScore(null, extras, profile)).toEqual({ score: 60, covers: ["amenities", "safety"] });
  expect(matchScore(null, empty, profile)).toBeNull();
  // Counts without ranks (e.g. no area data) are shown but never scored.
  expect(matchScore(null, { ...empty, transitStops: 500, schools: 60 }, profile)).toBeNull();
});

it("scores only chosen lifestyle priorities that have data and lists the rest", () => {
  // 1 Transit access, 4 Quiet & residential, 0 Family-friendly
  const extras = { ...ranked({ transitStops: 40, schools: 90 }), childrenPct: 10 };
  // transit 40; family = mean(children 10/20 → 50, school rank 90) = 70 → mean 55
  expect(lifestyleMatch(extras, [1, 4, 0])).toEqual({ score: 55, scored: ["Transit access", "Family-friendly"], unscored: ["Quiet & residential"] });
  expect(lifestyleMatch(extras, [])).toBeNull();
  expect(lifestyleMatch({ ...empty, transitStops: 400 }, [1])).toEqual({ score: null, scored: [], unscored: ["Transit access"] });
  expect(lifestyleMatch(extras, [99])).toBeNull();
});

it("adds lifestyle to the match score with its own weight, and scores parks from the green rank", () => {
  const lifestyleOnly = { ...profile, weights: [0, 0, 0, 0, 0, 5], priorities: [1] };
  expect(matchScore(null, ranked({ transitStops: 30 }), lifestyleOnly)).toEqual({ score: 30, covers: ["lifestyle"] });
  // 2 = Parks & green space; 3 = Restaurants & nightlife (still unscored)
  expect(lifestyleMatch({ ...empty, greenRank: 70 }, [2, 3])).toEqual({ score: 70, scored: ["Parks & green space"], unscored: ["Restaurants & nightlife"] });
  expect(lifestyleMatch(empty, [2])?.score).toBeNull();
});

// --- neighbourhoodMeasures against a fake /api/observations/batch/ ---
const catalog = {
  sources: [{ id: "boundaries-140-x" }, { id: "boundaries-158-x" }, { id: "ttc-x" }, { id: "toronto-green-spaces-x" }],
  indicators: [{ id: "area-within-1km-km2" }, { id: "places-within-1km-transit_stop", dimensions: { source_id: "ttc-x" } },
    { id: "green-parks-within-1km" }, { id: "green-space-share" }],
  geographies: [],
} as unknown as Catalog;
const place = (id: string, set: string) => ({ geography: { id, name: id, code: id, boundary_set: set, boundary_version: "" } }) as unknown as NeighbourhoodProfile;
const rows: Record<string, Record<string, Record<string, number>>> = {
  "toronto-158": {
    "area-within-1km-km2": { a: 10, b: 10, big: 100, c: 10 },
    "places-within-1km-transit_stop": { a: 100, b: 50, big: 500, c: 50 },  // big: most stops, lowest density
    "green-parks-within-1km": { a: 5, b: 5, big: 50, c: 1 },
    "green-space-share": { a: 10, b: 20, big: 30 },                         // c has no share
  },
  "toronto-140": {
    "area-within-1km-km2": { h1: 10, h2: 10 },
    "places-within-1km-transit_stop": { h1: 100, h2: 300 },                 // same count as a, different set
  },
};
function stubBatch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const q = new URL(url, "http://test").searchParams;
    const values = rows[q.get("geography_set_id")!]?.[q.get("indicator_id")!] ?? {};
    const observations = Object.entries(values).map(([geography_id, v]) => ({ geography_id, value: String(v), status: "observed", period: "2026-11-14", census_year: null, reference_year: 2026 }));
    return { ok: true, json: async () => ({ observations }) };
  }));
}

it("ranks place densities within each boundary set separately, and never favours size", async () => {
  stubBatch();
  const m = await neighbourhoodMeasures(catalog, [place("a", "toronto-158"), place("big", "toronto-158"), place("h1", "toronto-140")]);
  // 158 densities: a 10, b 5, c 5, big 5 → a is top; big's 500 stops do not help it.
  expect(m.byPlace.a.transitStops).toBe(100);
  expect(m.byPlace.a.ranks.transitStops).toBe(100);
  expect(m.byPlace.big.transitStops).toBe(500);
  expect(m.byPlace.big.ranks.transitStops).toBe(33);
  // h1 has a's count but is ranked only against the 140 set, where it is the lower one.
  expect(m.byPlace.h1.transitStops).toBe(100);
  expect(m.byPlace.h1.ranks.transitStops).toBe(0);
  expect(m.asOf.transit_stop).toBe("2026-11-14");
});

it("leaves lists without data unranked and scores green space from what exists", async () => {
  stubBatch();
  const m = await neighbourhoodMeasures(catalog, [place("c", "toronto-158"), place("h2", "toronto-140")]);
  // Libraries/schools/groceries are not in the catalog: no counts, no ranks.
  expect(m.byPlace.c.libraries).toBeNull();
  expect(m.byPlace.c.ranks.libraries).toBeNull();
  // c has parks but no green share: its green rank uses park density only (c is the least dense).
  expect(m.byPlace.c.greenSharePct).toBeNull();
  expect(m.byPlace.c.greenRank).toBe(0);
  // h2: 140 set has no green-space rows at all.
  expect(m.byPlace.h2.parks).toBeNull();
  expect(m.byPlace.h2.greenRank).toBeNull();
});
