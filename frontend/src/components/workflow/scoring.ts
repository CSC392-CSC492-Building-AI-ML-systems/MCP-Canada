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
export type MatchScore = { score: number; covers: string[] } | null;
/** Partial match: only the profile factors with data, weighted by the user's 0–5 weights.
 * Affordability: 100 at or below 75% of budget, 50 at budget, 0 at 125% or more.
 * Nearby amenities: the mean of the available density ranks of the four place lists within 1 km.
 * Safety: the share of Toronto neighbourhoods with more reported major crime per resident.
 * Lifestyle: the mean of the user's chosen priorities that have data (see lifestyleMatch).
 * Commute and school trip: 100 at or under half the longest acceptable trip, 50 at it, 0 at 1.5 times it. */
export function matchScore(shelterCost: number | null, extras: PlaceExtras | undefined, preferences: SearchProfile | null,
  trips: { work?: number | null; school?: number | null } = {}): MatchScore {
  if (!preferences) return null;
  const parts: { weight: number; value: number; name: string }[] = [];
  const budget = Number(preferences.rent);
  if (shelterCost !== null && budget > 0) parts.push({ weight: preferences.weights[0] ?? 0, name: "affordability",
    value: Math.max(0, Math.min(100, (1.25 - shelterCost / budget) / 0.5 * 100)) });
  const work = commuteScore(trips.work, preferences.trip);
  if (work !== null) parts.push({ weight: preferences.weights[1] ?? 0, name: "commute", value: work });
  const school = commuteScore(trips.school, preferences.trip);
  if (school !== null) parts.push({ weight: preferences.weights[2] ?? 0, name: "school trip", value: school });
  const amenities = mean(CORE_AMENITIES.map(key => rank(extras, key)));
  if (amenities !== null) parts.push({ weight: preferences.weights[3] ?? 0, name: "amenities", value: amenities });
  if (extras?.safety) parts.push({ weight: preferences.weights[4] ?? 0, name: "safety", value: extras.safety.saferThanPct });
  const lifestyle = lifestyleMatch(extras, preferences.priorities)?.score ?? null;
  if (lifestyle !== null) parts.push({ weight: preferences.weights[5] ?? 0, name: "lifestyle", value: lifestyle });
  const weighted = parts.filter(p => p.weight > 0);
  const total = weighted.reduce((sum, p) => sum + p.weight, 0);
  if (!total) return null;
  return { score: Math.round(weighted.reduce((sum, p) => sum + p.weight * p.value, 0) / total), covers: weighted.map(p => p.name) };
}
