/** Neighbourhood match scoring: how a profile's weights turn the comparison data
 * (comparison-extras.ts) and travel times (routing.ts) into one score per neighbourhood.
 * Every screen that shows a score should get it from here, so they always agree. */
import { commuteScore } from "@/lib/routing";
import { CORE_AMENITIES, type AmenityKey, type PlaceExtras } from "./comparison-extras";
import { LIFESTYLE_OPTIONS, type SearchProfile } from "./state";

/** A place list's sub-score is its density rank in the boundary set; unranked lists give null, never 0. */
const rank = (extras: PlaceExtras | undefined, key: AmenityKey) => extras?.ranks?.[key] ?? null;
const mean = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
};
/** Children 0–14 share at which "Family-friendly" scores 100 (Toronto 2021: about 14%). */
export const FAMILY_CHILDREN_PCT = 20;
/** How each lifestyle priority is scored from the data shown in the table; null = no data source. */
const LIFESTYLE_SCORERS: Record<(typeof LIFESTYLE_OPTIONS)[number], ((e: PlaceExtras | undefined) => number | null) | null> = {
  "Family-friendly": e => mean([e?.childrenPct != null ? Math.min(e.childrenPct / FAMILY_CHILDREN_PCT, 1) * 100 : null, rank(e, "schools"), rank(e, "childcare")]),
  "Transit access": e => rank(e, "transitStops"),
  "Parks & green space": e => e?.greenRank ?? null,
  "Restaurants & nightlife": e => rank(e, "dining"),
  // Low-rise housing share, and fewer restaurants and bars nearby than other neighbourhoods.
  "Quiet & residential": e => { const d = rank(e, "dining"); return mean([e?.lowRisePct ?? null, d === null ? null : 100 - d]); },
  // Cultural venues only; Census diversity figures are shown in the table but never scored.
  "Cultural community": e => rank(e, "culturalSpaces"),
  "Walkable errands": e => mean([rank(e, "groceries"), rank(e, "libraries"), rank(e, "errands")]),
  "Good school access": e => rank(e, "schools"),
};
export type LifestyleMatch = { score: number | null; scored: string[]; unscored: string[] };
/** Mean score of the user's chosen priorities that have data; the rest are listed, never scored as zero. */
export function lifestyleMatch(extras: PlaceExtras | undefined, priorities: number[] | undefined): LifestyleMatch | null {
  const chosen = [...new Set(priorities ?? [])].map(i => LIFESTYLE_OPTIONS[i]).filter(o => o !== undefined);
  if (!chosen.length) return null;
  const results = chosen.map(o => ({ o, value: LIFESTYLE_SCORERS[o]?.(extras) ?? null }));
  const scored = results.filter(r => r.value !== null);
  return { score: scored.length ? Math.round(mean(scored.map(r => r.value))!) : null,
    scored: scored.map(r => r.o), unscored: results.filter(r => r.value === null).map(r => r.o) };
}
/** The six profile factors, in the order of `SearchProfile.weights`. */
export const FACTORS = [
  { key: "affordability", label: "Affordability", name: "affordability",
    method: "2021 Census median monthly rent: 100 at or below 75% of your budget, 50 at your budget, 0 at 125% or more." },
  { key: "commute", label: "Commute to work", name: "commute",
    method: "Travel time to your work address: 100 at or under half your longest acceptable trip, 50 at it, 0 at 1.5 times it." },
  { key: "school", label: "School trip", name: "school trip",
    method: "Travel time to your school address, scored the same way as the commute." },
  { key: "amenities", label: "Nearby amenities", name: "amenities",
    method: "Mean density rank (0–100) of libraries, schools, groceries and transit stops within 1 km, among all neighbourhoods." },
  { key: "safety", label: "Safety", name: "safety",
    method: "Share of Toronto neighbourhoods with more reported major crime per resident (Toronto Police)." },
  { key: "lifestyle", label: "Lifestyle match", name: "lifestyle",
    method: "Mean score of your chosen lifestyle priorities that have data." },
] as const;
export type FactorKey = (typeof FACTORS)[number]["key"];

type FactorBase = { key: FactorKey; label: string; weight: number };
/** One profile factor: scored, unavailable (you weighted it but there is no data), or off (weight 0). */
export type Factor =
  | FactorBase & { status: "scored"; score: number; detail: string; method: string }
  | FactorBase & { status: "unavailable"; reason: string }
  | FactorBase & { status: "off" };

export type Breakdown = {
  /** Weighted mean of the scored factors; null when none could be scored. */
  score: number | null;
  /** How many weighted factors had data, out of how many you weighted above 0. */
  coverage: { used: number; weighted: number };
  /** All six factors, in profile order. */
  factors: Factor[];
  flags: ("over_budget")[];
};

export type Trips = { work?: number | null; school?: number | null };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** What each factor would score, or why it can't be, before weights are applied. */
function factorValues(shelterCost: number | null, extras: PlaceExtras | undefined, preferences: SearchProfile, trips: Trips) {
  const budget = Number(preferences.rent);
  const values: Record<FactorKey, { value: number; detail: string } | { reason: string }> = {} as never;

  values.affordability = shelterCost === null ? { reason: "No published rent for this neighbourhood" }
    : !(budget > 0) ? { reason: "No rent budget in your profile" }
    : { value: Math.max(0, Math.min(100, (1.25 - shelterCost / budget) / 0.5 * 100)),
        detail: `${money(shelterCost)}/mo, ${shelterCost <= budget ? "within" : `${money(shelterCost - budget)} over`} your budget` };

  const trip = (minutes: number | null | undefined, hasDestination: boolean, what: string) => {
    const value = commuteScore(minutes, preferences.trip);
    if (value === null || minutes == null) return { reason: hasDestination ? "No travel time for this neighbourhood" : `No ${what} address in your profile` };
    return { value, detail: `${minutes} min by ${preferences.mode.toLowerCase()} (your limit is ${preferences.trip} min)` };
  };
  values.commute = trip(trips.work, !!preferences.workPoint, "work");
  values.school = trip(trips.school, !!preferences.schoolPoint, "school");

  const amenities = mean(CORE_AMENITIES.map(key => rank(extras, key)));
  values.amenities = amenities === null ? { reason: "No nearby place data for this neighbourhood" }
    : { value: amenities, detail: `Ranks ${Math.round(amenities)} of 100 for libraries, schools, groceries and transit stops nearby` };

  values.safety = extras?.safety
    ? { value: extras.safety.saferThanPct, detail: `Less reported crime than ${extras.safety.saferThanPct}% of neighbourhoods (${extras.safety.year})` }
    : { reason: extras?.safetyGap ?? "Police crime data unavailable" };

  const lifestyle = lifestyleMatch(extras, preferences.priorities);
  values.lifestyle = !lifestyle ? { reason: "No lifestyle priorities chosen in your profile" }
    : lifestyle.score === null ? { reason: `No data for ${lifestyle.unscored.join(", ")}` }
    : { value: lifestyle.score, detail: `Scored: ${lifestyle.scored.join(", ")}${lifestyle.unscored.length ? `. No data: ${lifestyle.unscored.join(", ")}` : ""}` };
  return values;
}

/** The match score with every factor shown: scored ones with their number and method, weighted ones
 * without data as unavailable (left out, never counted as 0), and weight-0 ones as off. The weights of
 * the factors left out are dropped, so the remaining ones share the score between them. */
export function scoreBreakdown(shelterCost: number | null, extras: PlaceExtras | undefined, preferences: SearchProfile | null,
  trips: Trips = {}): Breakdown | null {
  if (!preferences) return null;
  const values = factorValues(shelterCost, extras, preferences, trips);
  const scored: { weight: number; value: number }[] = [];
  const factors: Factor[] = FACTORS.map(({ key, label, method }, i) => {
    const weight = preferences.weights[i] ?? 0;
    if (weight <= 0) return { key, label, weight, status: "off" };
    const v = values[key];
    if ("reason" in v) return { key, label, weight, status: "unavailable", reason: v.reason };
    scored.push({ weight, value: v.value });
    return { key, label, weight, status: "scored", score: Math.round(v.value), detail: v.detail, method };
  });
  const total = scored.reduce((sum, p) => sum + p.weight, 0);
  const budget = Number(preferences.rent);
  return {
    score: total ? Math.round(scored.reduce((sum, p) => sum + p.weight * p.value, 0) / total) : null,
    coverage: { used: scored.length, weighted: factors.filter(f => f.status !== "off").length },
    factors,
    flags: shelterCost !== null && budget > 0 && shelterCost > budget ? ["over_budget"] : [],
  };
}

export type MatchScore = { score: number; covers: string[] } | null;
/** Short form of scoreBreakdown for the comparison table: the score and the factors it covers. */
export function matchScore(shelterCost: number | null, extras: PlaceExtras | undefined, preferences: SearchProfile | null,
  trips: Trips = {}): MatchScore {
  const breakdown = scoreBreakdown(shelterCost, extras, preferences, trips);
  if (!breakdown || breakdown.score === null) return null;
  const covers = breakdown.factors.filter(f => f.status === "scored").map(f => FACTORS.find(d => d.key === f.key)!.name);
  return { score: breakdown.score, covers };
}
