import type { Catalog } from "../explorer/data";
import type { CostRow } from "./recommendations";

/** Uses existing read-only APIs; works when the optional batch endpoint is absent. */
export async function loadCostRows(catalog: Catalog, signal?: AbortSignal): Promise<CostRow[]> {
  const releases = catalog.sources.filter(source => source.id.startsWith("census-2021-"));
  if (releases.length !== 1) throw new Error("A unique reviewed 2021 Census release is required. You can still explore and save places manually.");
  const sourceId = releases[0].id;
  const indicatorId = "census-2021-row-380";
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
