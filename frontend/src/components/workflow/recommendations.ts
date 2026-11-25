import type { ExplorerPlace } from "../explorer/PlacesSidebar";
import { scoreBreakdown, type Breakdown, type Trips } from "./scoring";
import type { PlaceExtras } from "./comparison-extras";
import type { SearchProfile } from "./state";

export type CostRow = { geography_id: string; name: string; value: string | null; status: string; census_year: number; source_locator: string };
/** One neighbourhood's inputs to the match score: the same ones the neighbourhood panel uses. */
export type Candidate = { id: string; name: string; cost: number | null; extras: PlaceExtras | undefined; trips?: Trips };
export type RankedPlace = ExplorerPlace & { breakdown: Breakdown };

/** The published 2021 median rent for each neighbourhood; missing, suppressed or invalid values are null, never 0. */
export function costById(rows: CostRow[]): Map<string, number | null> {
  return new Map(rows.map(row => {
    const n = Number(row.value);
    const ok = row.status === "observed" && row.value !== null && Number.isFinite(n) && n >= 0 && row.census_year === 2021;
    return [row.geography_id, ok ? n : null];
  }));
}

/** Neighbourhoods ranked by match score, using scoreBreakdown so a place shows the same score here as
 * when it is searched or compared. Places with no score are left out; ties sort by name. */
export function rankByMatch(candidates: Candidate[], profile: SearchProfile, limit = 5): RankedPlace[] {
  return candidates
    .map(c => ({ c, breakdown: scoreBreakdown(c.cost, c.extras, profile, c.trips ?? {}) }))
    .filter((r): r is { c: Candidate; breakdown: Breakdown & { score: number } } => r.breakdown?.score != null)
    .sort((a, b) => b.breakdown.score - a.breakdown.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(({ c, breakdown }) => ({ id: c.id, name: c.name, boundary: "toronto-158", year: 2021, score: breakdown.score, breakdown,
      summary: placeSummary(c.cost, Number(profile.rent), breakdown) }));
}

function placeSummary(cost: number | null, budget: number, breakdown: Breakdown) {
  const parts = [cost === null ? "Rent unavailable" : `$${cost.toLocaleString("en-CA")} / mo. · ${cost <= budget ? "within" : "above"} your budget`];
  if (breakdown.flags.includes("commute_over_limit")) parts.push("a trip is over your limit");
  parts.push(`${breakdown.coverage.used} of ${breakdown.coverage.weighted} factors`);
  return parts.join(" · ");
}
