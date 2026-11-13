import type { ExplorerPlace } from "../explorer/PlacesSidebar";
import type { SearchProfile } from "./state";
export type CostRow = { geography_id: string; name: string; value: string | null; status: string; census_year: number; source_locator: string };
/** Limited, transparent ordering by the published housing benchmark; no inferred fit score. */
export function budgetStartingPoints(rows: CostRow[], profile: SearchProfile): ExplorerPlace[] {
  if (profile.weights[0] === 0) return [];
  const limit = Number(profile.rent);
  const available = rows.filter(r => r.status === "observed" && r.value !== null && Number.isFinite(Number(r.value)) && Number(r.value) >= 0 && r.census_year === 2021);
  const withinBudget = available.filter(row => Number(row.value) <= limit);
  return (withinBudget.length ? withinBudget : available)
    .sort((a, b) => Number(a.value) - Number(b.value) || a.name.localeCompare(b.name))
    .slice(0, 5).map(row => ({ id: row.geography_id, name: row.name, boundary: "toronto-158", year: 2021, score: null,
      summary: `$${Number(row.value).toLocaleString("en-CA")} / mo. · ${Number(row.value) <= limit ? "within" : "above"} your budget · 2021 Census` }));
}
