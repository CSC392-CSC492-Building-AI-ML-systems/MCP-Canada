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
    method: "2021 Census median monthly rent against your budget (100 at or below 75% of it, 50 at it, 0 at 125% or more) and, "
      + "if you gave an income, against 30% of your monthly income (100 at or under 30%, 0 at 50% or more). The lower of the two counts." },
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
  flags: ("over_budget" | "over_income_guideline" | "commute_over_limit")[];
  /** Each trip with a destination, checked against your limit on its own. */
  trips: TripCheck[];
};

export type Trips = { work?: number | null; school?: number | null };
export type TripKind = "work" | "school";
/** overLimit is null when the trip has no travel time: "unavailable", never assumed fine or too long. */
export type TripCheck = { trip: TripKind; minutes: number | null; overLimit: boolean | null };

/** Checks every trip against the limit separately, never their average: 20 and 55 minutes with a
 * 40-minute limit is over the limit even though the average is 37.5. Trips without a destination
 * are left out. */
export function commuteCheck(trips: Partial<Record<TripKind, number | null | undefined>>, limit: number,
  destinations: Record<TripKind, boolean> = { work: true, school: true }): { checks: TripCheck[]; anyOverLimit: boolean } {
  const checks = (["work", "school"] as const).filter(t => destinations[t]).map(trip => {
    const minutes = trips[trip] ?? null;
    return { trip, minutes, overLimit: minutes === null || !(limit > 0) ? null : minutes > limit };
  });
  return { checks, anyOverLimit: checks.some(c => c.overLimit === true) };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** Share of income the proposal and CMHC use as the affordability reference point. */
export const INCOME_GUIDELINE_PCT = 30;
/** Share of income at which the income part of affordability reaches 0. */
export const INCOME_ZERO_PCT = 50;

export type Affordability = { score: number; withinBudget: boolean; incomeSharePct: number | null; meetsGuideline: boolean | null };
/** Rent against the budget and, when an income is given, against 30% of monthly before-tax income.
 * The household's combined income is the one in the profile. The score is the lower of the two parts,
 * so a place has to work on both to score well. */
export function affordabilityScore(rent: number, budget: number, annualIncome: number | null): Affordability {
  const budgetPart = Math.max(0, Math.min(100, (1.25 - rent / budget) / 0.5 * 100));
  const share = annualIncome !== null && annualIncome > 0 ? rent * 1200 / annualIncome : null; // rent ÷ monthly income × 100, exact for whole dollars
  const incomePart = share === null ? null
    : Math.max(0, Math.min(100, (INCOME_ZERO_PCT - share) / (INCOME_ZERO_PCT - INCOME_GUIDELINE_PCT) * 100));
  return {
    score: incomePart === null ? budgetPart : Math.min(budgetPart, incomePart),
    withinBudget: rent <= budget,
    incomeSharePct: share,
    meetsGuideline: share === null ? null : share <= INCOME_GUIDELINE_PCT,
  };
}
const annualIncome = (profile: SearchProfile) => {
  const n = Number(profile.income);
  return profile.income.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** What each factor would score, or why it can't be, before weights are applied. */
function factorValues(shelterCost: number | null, extras: PlaceExtras | undefined, preferences: SearchProfile, trips: Trips) {
  const budget = Number(preferences.rent);
  const values: Record<FactorKey, { value: number; detail: string } | { reason: string }> = {} as never;

  if (shelterCost === null) values.affordability = { reason: "No published rent for this neighbourhood" };
  else if (!(budget > 0)) values.affordability = { reason: "No rent budget in your profile" };
  else {
    const a = affordabilityScore(shelterCost, budget, annualIncome(preferences));
    const vsBudget = a.withinBudget ? "within your budget" : `${money(shelterCost - budget)} over your budget`;
    const share = a.incomeSharePct === null ? "" : `${Math.round(a.incomeSharePct)}% of your monthly income`;
    // Say "but" when the income check is what pulls a within-budget place down, so the low score makes sense.
    const detail = !share ? vsBudget
      : a.meetsGuideline === false && a.withinBudget ? `${vsBudget}, but ${share} (the guideline is ${INCOME_GUIDELINE_PCT}% or less)`
      : a.meetsGuideline === false ? `${vsBudget} and ${share} (the guideline is ${INCOME_GUIDELINE_PCT}% or less)`
      : `${vsBudget}, ${share}`;
    values.affordability = { value: a.score, detail: `${money(shelterCost)}/mo, ${detail}` };
  }

  const trip = (minutes: number | null | undefined, hasDestination: boolean, what: string) => {
    const value = commuteScore(minutes, preferences.trip);
    if (value === null || minutes == null) return { reason: hasDestination ? "No travel time for this neighbourhood" : `No ${what} address in your profile` };
    const over = preferences.trip > 0 && minutes > preferences.trip;
    return { value, detail: `${minutes} min by ${preferences.mode.toLowerCase()}, ${over ? "over" : "within"} your ${preferences.trip}-minute limit` };
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
  const afford = shelterCost !== null && budget > 0 ? affordabilityScore(shelterCost, budget, annualIncome(preferences)) : null;
  const flags: Breakdown["flags"] = [];
  if (afford && !afford.withinBudget) flags.push("over_budget");
  if (afford?.meetsGuideline === false) flags.push("over_income_guideline");
  const commute = commuteCheck(trips, preferences.trip, { work: !!preferences.workPoint, school: !!preferences.schoolPoint });
  if (commute.anyOverLimit) flags.push("commute_over_limit");
  return {
    score: total ? Math.round(scored.reduce((sum, p) => sum + p.weight * p.value, 0) / total) : null,
    coverage: { used: scored.length, weighted: factors.filter(f => f.status !== "off").length },
    factors,
    flags,
    trips: commute.checks,
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

const TRIP_NAMES: Record<TripKind, string> = { work: "work trip", school: "school trip" };

/** "Why this score" in plain language, built only from the breakdown so it can never disagree with
 * the number: what helped most, what held it back most, any flags, and which weighted factors had no
 * data. Weight-0 factors are not mentioned. Contribution = weight × score; cost = weight × (100 − score). */
export function explainScore(breakdown: Breakdown): string[] {
  const scored = breakdown.factors.filter((f): f is Extract<Factor, { status: "scored" }> => f.status === "scored");
  const missing = breakdown.factors.filter(f => f.status === "unavailable").map(f => f.label);
  const lines: string[] = [];
  if (breakdown.score === null) {
    lines.push("There is no score for this neighbourhood: none of the factors you weighted have data here.");
  } else {
    const best = scored.reduce((a, b) => b.weight * b.score > a.weight * a.score ? b : a);
    lines.push(`Strongest: ${best.label}, ${best.score}/100 (${best.detail}).`);
    const others = scored.filter(f => f !== best);
    if (others.length) {
      const worst = others.reduce((a, b) => b.weight * (100 - b.score) > a.weight * (100 - a.score) ? b : a);
      if (worst.score < 100) lines.push(`Held back most by: ${worst.label}, ${worst.score}/100 (${worst.detail}).`);
    }
  }
  if (breakdown.flags.includes("over_budget")) lines.push("Rent is over your budget.");
  if (breakdown.flags.includes("over_income_guideline")) lines.push(`Rent is more than ${INCOME_GUIDELINE_PCT}% of your monthly income.`);
  for (const t of breakdown.trips) if (t.overLimit) lines.push(`The ${TRIP_NAMES[t.trip]} (${t.minutes} min) is over your limit.`);
  if (missing.length) lines.push(`Not included, because there is no data: ${missing.join(", ")}.`);
  if (breakdown.score !== null) lines.push(`Based on ${breakdown.coverage.used} of the ${breakdown.coverage.weighted} factors you weighted.`);
  return lines;
}
