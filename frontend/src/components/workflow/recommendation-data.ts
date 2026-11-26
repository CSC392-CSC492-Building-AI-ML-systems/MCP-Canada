import type { Catalog } from "../explorer/data";
import type { NeighbourhoodProfile } from "../explorer/types";
import { commuteTimes, isTravelMode } from "@/lib/routing";
import { neighbourhoodOrigins } from "./commutes";
import { loadComparisonExtras, type ComparisonExtras } from "./comparison-extras";
import type { CostRow } from "./recommendations";
import type { Trips } from "./scoring";
import type { SearchProfile } from "./state";

/** Uses existing read-only APIs; works when the optional batch endpoint is absent. */
export async function loadCostRows(catalog: Catalog, signal?: AbortSignal): Promise<CostRow[]> {
  const releases = catalog.sources.filter(source => source.id.startsWith("census-2021-"));
  if (releases.length !== 1) throw new Error("A unique reviewed 2021 Census release is required. You can still explore and save places manually.");
  const sourceId = releases[0].id;
  const indicatorId = "census-2021-row-381";
  const params = new URLSearchParams({ source_id: sourceId, indicator_id: indicatorId, geography_set_id: "toronto-158" });
  const batch = await fetch(`/api/observations/batch/?${params}`, { signal });
  if (batch.ok) return (await batch.json()).observations;
  if (batch.status !== 404 && batch.status !== 405) throw new Error("Could not load housing benchmarks. Try again or explore the map directly.");
  const places = catalog.geographies.filter(geography => geography.geography_set_id === "toronto-158");
  const result: CostRow[] = [];
  let index = 0;
  async function worker() {
    while (index < places.length) {
      signal?.throwIfAborted();
      const place = places[index++];
      const query = new URLSearchParams({ source_id: sourceId, indicator_id: indicatorId, geography_id: place.id });
      const response = await fetch(`/api/observations/?${query}`, { signal });
      if (!response.ok) throw new Error("Could not load housing benchmarks. Try again or explore the map directly.");
      const data = await response.json();
      const annual = data.observations.filter((row: { census_year: number; period: string }) => row.census_year === 2021 && row.period === "annual");
      if (annual.length === 1) result.push({ ...annual[0], geography_id: place.id, name: place.name });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, places.length) }, worker));
  return result;
}

/** Safety, amenity and lifestyle data for every current (158) neighbourhood, ranked against each other,
 * so each place gets the same inputs here as on its own panel. */
export function loadAllExtras(catalog: Catalog, signal?: AbortSignal): Promise<ComparisonExtras> {
  // Only the geography and year are read by loadComparisonExtras; the rest of a full profile is not needed.
  const profiles = catalog.geographies.filter(g => g.geography_set_id === "toronto-158").map(g => ({
    geography: { id: g.id, name: g.name, code: g.code, boundary_set: g.geography_set_id, boundary_version: g.geography_set__version },
    year: 2021, available_years: [2021],
  }) as unknown as NeighbourhoodProfile);
  return loadComparisonExtras(catalog, profiles, 2021, signal);
}

/** The transit endpoint accepts up to 10 origins per request. */
const ORIGINS_PER_REQUEST = 10;
/** Travel times from each neighbourhood to the profile's work and school addresses, for trips that have one. */
export async function loadTripTimes(ids: string[], profile: SearchProfile, signal?: AbortSignal): Promise<Record<string, Trips>> {
  const mode = isTravelMode(profile.mode) ? profile.mode : "Transit";
  const result: Record<string, Trips> = Object.fromEntries(ids.map(id => [id, {}]));
  const destinations = ([["work", profile.workPoint], ["school", profile.schoolPoint]] as const).filter(([, p]) => p);
  if (!destinations.length) return result;
  const origins = await neighbourhoodOrigins(ids.map(id => ({ id, boundarySetId: "toronto-158" })));
  for (const [trip, point] of destinations) {
    for (let i = 0; i < origins.length; i += ORIGINS_PER_REQUEST) {
      const times = await commuteTimes(mode, origins.slice(i, i + ORIGINS_PER_REQUEST), [point!.lng, point!.lat], signal);
      for (const [id, commute] of Object.entries(times.byId)) if (result[id]) result[id][trip] = commute.minutes;
    }
  }
  return result;
}
