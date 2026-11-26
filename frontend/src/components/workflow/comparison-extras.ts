/** Extra comparison rows built only from data already loaded in the backend:
 * Census population, age mix, housing types and newcomer/visible-minority shares,
 * place lists near each neighbourhood (libraries, schools, grocers, transit stops,
 * dining, everyday services, child care, cultural spaces), and Toronto Police reported
 * major crime for the selected year. */
import type { Catalog } from "../explorer/data";
import { censusSources } from "../explorer/censusSource";
import type { NeighbourhoodProfile } from "../explorer/types";

export type ExtraSource = { id: string; title: string; publisher: string; url: string };
export type NearbyCategory = "library" | "school" | "grocery" | "transit_stop" | "dining" | "errand_service" | "childcare" | "cultural_space";
export type AmenityKey = "libraries" | "schools" | "groceries" | "transitStops" | "dining" | "errands" | "childcare" | "culturalSpaces";
/** Census shares beyond the age mix; published for 2021 only so far (null for other years). */
type CensusShares = { lowRisePct: number | null; immigrantPct: number | null; visibleMinorityPct: number | null };
/** Reported major crime per 100,000 residents, with its rank among Toronto's 158 neighbourhoods. */
export type Safety = { rate: number; year: number; cityMedian: number; saferThanPct: number };
export type PlaceExtras = CensusShares & {
  population: number | null; childrenPct: number | null; seniorsPct: number | null;
  /** Places within 1 km (counts shown in the table). */
  libraries: number | null; schools: number | null; groceries: number | null; transitStops: number | null;
  dining: number | null; errands: number | null; childcare: number | null; culturalSpaces: number | null;
  /** Rank (0–100) of each count's density among all areas in the same boundary set; null = not ranked. */
  ranks: Record<AmenityKey, number | null>;
  safety: Safety | null;
  /** Why safety is missing, when it is. */
  safetyGap: string | null;
  /** City parks within 1 km, green-space % of area, and the mean of their ranks (park density and
   * green-space share, 0–100) within the boundary set. */
  parks: number | null; greenSharePct: number | null; greenRank: number | null;
};
export type ComparisonExtras = {
  byPlace: Record<string, PlaceExtras>;
  /** Newest snapshot date of each place list. */
  asOf: Partial<Record<NearbyCategory | "park", string>>;
  sources: ExtraSource[];
};
export const emptyExtras: ComparisonExtras = { byPlace: {}, asOf: {}, sources: [] };

// Reviewed Census row IDs. Children are 0–14 and seniors 65+ in every year.
type AgeRows = { population: number; total: number[]; children: number[]; seniors: number[]; percent?: boolean;
  /** Counts whose share of a total row is reported (e.g. low-rise dwellings of all occupied dwellings). */
  shares?: Record<keyof CensusShares, { parts: number[]; total: number }> };
const ageRows: Record<number, AgeRows> = {
  2001: { population: 3, total: [6], children: [7, 8, 9], seniors: [20, 21, 22, 23, 24, 25, 26, 27] },
  2006: { population: 3, total: [6], children: [7, 8, 9], seniors: [20, 21, 22, 23, 24, 25, 26, 27] },
  2011: { population: 2, total: [9], children: [10], seniors: [29, 33, 38] },
  2016: { population: 4, total: [11, 12, 13, 14, 15], children: [11], seniors: [15] },
  // 2021 publishes the shares directly; its population is the age total (25% sample).
  2021: { population: 4, total: [], children: [31], seniors: [33], percent: true, shares: {
    // Ground-oriented and low-rise: single-detached, semi-detached, row, duplex, other single-attached.
    lowRisePct: { parts: [218, 219, 220, 221, 224], total: 217 },
    immigrantPct: { parts: [1488], total: 1486 },
    visibleMinorityPct: { parts: [1643], total: 1642 },
  } },
};
const noShares = (): CensusShares => ({ lowRisePct: null, immigrantPct: null, visibleMinorityPct: null });

type BatchRow = { geography_id: string; value: string | null; status: string; census_year: number | null; reference_year: number; period: string };
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load comparison data.");
  return data;
}
const observed = (row?: BatchRow) => row && row.status === "observed" && row.value !== null && Number.isFinite(Number(row.value)) ? Number(row.value) : null;

async function censusRows(catalog: Catalog, year: number, setId: string, ids: string[], signal?: AbortSignal) {
  const rows = ageRows[year];
  const releases = censusSources(catalog.sources, year);
  const empty = Object.fromEntries(ids.map(id => [id, { population: null, childrenPct: null, seniorsPct: null, ...noShares() }]));
  if (!rows || releases.length !== 1) return { values: empty, source: null };
  const source = releases[0];
  const shareRows = Object.values(rows.shares ?? {}).flatMap(s => [...s.parts, s.total]);
  const all = [...new Set([rows.population, ...rows.total, ...rows.children, ...rows.seniors, ...shareRows])];
  const results = await Promise.all(all.map(async row => {
    const indicator = `census-${year}-row-${row}`;
    if (!catalog.indicators.some(i => i.id === indicator)) return [row, new Map<string, number | null>()] as const;
    const data = await getJson<{ observations: BatchRow[] }>(`/api/observations/batch/?${new URLSearchParams({ geography_set_id: setId, indicator_id: indicator, source_id: source.id })}`, signal);
    const byPlace = new Map<string, number | null>();
    for (const id of ids) {
      const matches = data.observations.filter(o => o.geography_id === id && o.census_year === year && o.period === "annual");
      byPlace.set(id, matches.length === 1 ? observed(matches[0]) : null);
    }
    return [row, byPlace] as const;
  }));
  const lookup = new Map(results);
  // A sum is only reported when every part is published; a gap is never treated as zero.
  const sum = (id: string, list: number[]) => {
    const parts = list.map(r => lookup.get(r)?.get(id) ?? null);
    return parts.length && parts.every(p => p !== null) ? parts.reduce((a, b) => a! + b!, 0)! : null;
  };
  const share = (id: string, list: number[]) => {
    if (rows.percent) return sum(id, list);
    const part = sum(id, list); const total = sum(id, rows.total);
    return part !== null && total ? part / total * 100 : null;
  };
  const countShare = (id: string, s: { parts: number[]; total: number } | undefined) => {
    if (!s) return null;
    const part = sum(id, s.parts); const total = lookup.get(s.total)?.get(id) ?? null;
    return part !== null && total ? Math.min(part / total * 100, 100) : null;
  };
  const values = Object.fromEntries(ids.map(id => [id, {
    population: lookup.get(rows.population)?.get(id) ?? null,
    childrenPct: share(id, rows.children), seniorsPct: share(id, rows.seniors),
    lowRisePct: countShare(id, rows.shares?.lowRisePct), immigrantPct: countShare(id, rows.shares?.immigrantPct),
    visibleMinorityPct: countShare(id, rows.shares?.visibleMinorityPct),
  } satisfies CensusShares & Pick<PlaceExtras, "population" | "childrenPct" | "seniorsPct">]));
  return { values, source };
}

/** Toronto Police "major crime indicators", summed per 100,000 residents. Rates share one
 * population denominator within a year, so their sum is the combined rate. */
export const MAJOR_CRIMES = ["assault", "autotheft", "breakenter", "robbery", "theftover"] as const;
export const CRIME_YEARS = { first: 2014, last: 2025 };

/** The 158-model area holding crime data: the place itself, its linked data area, or its unchanged counterpart. */
function crimeGeography(catalog: Catalog, p: NeighbourhoodProfile) {
  if (p.geography.boundary_set === "toronto-158") return p.geography.id;
  if (p.data_geography?.boundary_set === "toronto-158") return p.data_geography.id;
  return catalog.geographies.find(g => g.geography_set_id === "toronto-158" && g.code === p.geography.code
    && g.name.trim().toLowerCase() === p.geography.name.trim().toLowerCase())?.id ?? null;
}

export function rankSafety(rates: Map<string, number>, id: string, year: number): Safety | null {
  const rate = rates.get(id);
  if (rate === undefined || !rates.size) return null;
  const all = [...rates.values()].sort((a, b) => a - b);
  const mid = Math.floor(all.length / 2);
  const cityMedian = all.length % 2 ? all[mid] : (all[mid - 1] + all[mid]) / 2;
  return { rate, year, cityMedian, saferThanPct: Math.round(all.filter(r => r > rate).length / all.length * 100) };
}

/** The police crime release to read: MCP-Canada first (backend `load_crime_from_mcp` saves it
 * as `mcp-canada-crime-rates`, checked with `compare_crime_sources`), else the CSV release
 * `crime-rates-...`. Returns a list so callers keep their "exactly one release" check. */
export function crimeSources<S extends { id: string }>(sources: S[]): S[] {
  const mcp = sources.filter(s => s.id === "mcp-canada-crime-rates");
  return mcp.length ? mcp : sources.filter(s => s.id.startsWith("crime-rates-"));
}

async function safety(catalog: Catalog, profiles: NeighbourhoodProfile[], year: number, signal?: AbortSignal) {
  const releases = crimeSources(catalog.sources);
  const gap = (reason: string) => ({ byPlace: Object.fromEntries(profiles.map(p => [p.geography.id, { safety: null, safetyGap: reason }])), source: null });
  if (releases.length !== 1 || !MAJOR_CRIMES.every(c => catalog.indicators.some(i => i.id === `tps-crime-${c}-rate`))) return gap("Police crime data not loaded");
  if (year < CRIME_YEARS.first || year > CRIME_YEARS.last) return gap(`Police data covers ${CRIME_YEARS.first}–${CRIME_YEARS.last}`);
  const source = releases[0];
  const parts = await Promise.all(MAJOR_CRIMES.map(c => getJson<{ observations: BatchRow[] }>(`/api/observations/batch/?${new URLSearchParams({
    geography_set_id: "toronto-158", indicator_id: `tps-crime-${c}-rate`, source_id: source.id, reference_year: String(year) })}`, signal)));
  // A neighbourhood is ranked only when all five rates are published for it.
  const byArea = new Map<string, number[]>();
  for (const part of parts) for (const row of part.observations) {
    const value = row.period === "annual" ? observed(row) : null;
    if (value !== null) byArea.set(row.geography_id, [...(byArea.get(row.geography_id) ?? []), value]);
  }
  const rates = new Map([...byArea].filter(([, v]) => v.length === MAJOR_CRIMES.length).map(([id, v]) => [id, v.reduce((a, b) => a + b, 0)]));
  if (!rates.size) return gap(`No police data for ${year}`);
  return {
    byPlace: Object.fromEntries(profiles.map(p => {
      const id = crimeGeography(catalog, p);
      const ranked = id ? rankSafety(rates, id, year) : null;
      return [p.geography.id, { safety: ranked, safetyGap: ranked ? null : id ? `No police data for ${year}` : "Area changed in 2021; no matching police neighbourhood" }];
    })),
    source,
  };
}

/** Percentile rank (0–100) of `value` among `values`: the share of the other values below it,
 * with ties counted as half, so equal values always get equal ranks. Needs two or more values. */
export function percentRank(values: number[], value: number) {
  if (values.length < 2) return null;
  const below = values.filter(v => v < value).length;
  const ties = values.filter(v => v === value).length;
  return Math.round((below + Math.max(ties - 1, 0) / 2) / (values.length - 1) * 100);
}
/** Ranks every area that has a value; areas without one are simply not in the map. */
export function rankAll(values: Map<string, number>) {
  const all = [...values.values()];
  return new Map([...values].map(([id, v]) => [id, percentRank(all, v)]));
}

type Dimensions = { source_id?: string };
const dimensionsOf = (catalog: Catalog, id: string) =>
  (catalog.indicators.find(i => i.id === id) as { dimensions?: Dimensions } | undefined)?.dimensions;

/** One value per area for a whole boundary set; areas with several or no observed values are left out. */
async function setValues(set: string, indicator: string, source: string, signal?: AbortSignal) {
  const data = await getJson<{ observations: BatchRow[] }>(`/api/observations/batch/?${new URLSearchParams({ geography_set_id: set, indicator_id: indicator, source_id: source })}`, signal);
  const groups = new Map<string, BatchRow[]>();
  for (const row of data.observations) groups.set(row.geography_id, [...(groups.get(row.geography_id) ?? []), row]);
  const values = new Map([...groups].flatMap(([id, rows]) => { const v = rows.length === 1 ? observed(rows[0]) : null; return v === null ? [] : [[id, v] as const]; }));
  return { values, period: data.observations.map(o => o.period).sort().at(-1) ?? null };
}

/** Rows read for each place list: the table field, its source category, and the stored count indicator. */
export const AMENITY_LISTS: [AmenityKey, NearbyCategory][] = [
  ["libraries", "library"], ["schools", "school"], ["groceries", "grocery"], ["transitStops", "transit_stop"],
  ["dining", "dining"], ["errands", "errand_service"], ["childcare", "childcare"], ["culturalSpaces", "cultural_space"]];
/** The lists averaged into the "Nearby amenities" factor; the others feed lifestyle priorities only. */
export const CORE_AMENITIES: AmenityKey[] = ["libraries", "schools", "groceries", "transitStops"];
const AREA_INDICATOR = "area-within-1km-km2";
type MeasureValues = Pick<PlaceExtras, AmenityKey | "ranks" | "parks" | "greenSharePct" | "greenRank">;
const noAmenities = () => Object.fromEntries(AMENITY_LISTS.map(([key]) => [key, null])) as Record<AmenityKey, null>;
const noMeasures = (): MeasureValues => ({ ...noAmenities(), ranks: noAmenities(), parks: null, greenSharePct: null, greenRank: null });

/** Place counts and green space for the compared areas, ranked against every area in the same
 * boundary set. Counts are ranked as densities (per km² within 1 km), so a neighbourhood does not
 * rank high just for being large; green-space share is already a proportion. */
export async function neighbourhoodMeasures(catalog: Catalog, profiles: NeighbourhoodProfile[], signal?: AbortSignal) {
  const byPlace: Record<string, MeasureValues> = Object.fromEntries(profiles.map(p => [p.geography.id, noMeasures()]));
  const asOf: ComparisonExtras["asOf"] = {};
  const sources = new Map<string, ExtraSource>();
  const known = (id: string | undefined) => catalog.sources.find(s => s.id === id);
  const green = catalog.sources.filter(s => s.id.startsWith("toronto-green-spaces-"));
  for (const set of [...new Set(profiles.map(p => p.geography.boundary_set))]) {
    const members = profiles.filter(p => p.geography.boundary_set === set);
    const boundary = catalog.sources.filter(s => s.id.startsWith(`boundaries-${set.replace("toronto-", "")}-`));
    // Without the area denominator, counts are still shown but not ranked.
    const area = boundary.length === 1 && catalog.indicators.some(i => i.id === AREA_INDICATOR)
      ? (await setValues(set, AREA_INDICATOR, boundary[0].id, signal)).values : new Map<string, number>();
    const density = (counts: Map<string, number>) =>
      new Map([...counts].flatMap(([id, n]) => { const a = area.get(id); return a && a > 0 ? [[id, n / a] as const] : []; }));
    for (const [key, category] of AMENITY_LISTS) {
      const indicator = `places-within-1km-${category}`;
      const source = known(dimensionsOf(catalog, indicator)?.source_id);
      if (!source) continue;  // list not loaded: no count and no rank, never a zero
      const { values, period } = await setValues(set, indicator, source.id, signal);
      const ranks = rankAll(density(values));
      for (const p of members) {
        byPlace[p.geography.id][key] = values.get(p.geography.id) ?? null;
        byPlace[p.geography.id].ranks[key] = ranks.get(p.geography.id) ?? null;
      }
      if (period) asOf[category] = period;
      sources.set(source.id, source);
    }
    if (green.length === 1 && ["green-parks-within-1km", "green-space-share"].every(id => catalog.indicators.some(i => i.id === id))) {
      const [parks, share] = await Promise.all(["green-parks-within-1km", "green-space-share"].map(id => setValues(set, id, green[0].id, signal)));
      const parkRanks = rankAll(density(parks.values)); const shareRanks = rankAll(share.values);
      for (const p of members) {
        const id = p.geography.id;
        const ranks = [parkRanks.get(id) ?? null, shareRanks.get(id) ?? null].filter((r): r is number => r !== null);
        Object.assign(byPlace[id], { parks: parks.values.get(id) ?? null, greenSharePct: share.values.get(id) ?? null,
          greenRank: ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null });
      }
      if (share.period) asOf.park = share.period;
      sources.set(green[0].id, green[0]);
    }
  }
  return { byPlace, asOf, sources: [...sources.values()] };
}

export async function loadComparisonExtras(catalog: Catalog, profiles: NeighbourhoodProfile[], year: number, signal?: AbortSignal): Promise<ComparisonExtras> {
  // Census values come from the geography that holds the data (an unchanged counterpart when linked).
  const dataId = (p: NeighbourhoodProfile) => p.available_years.length ? p.data_geography?.id ?? p.geography.id : null;
  const groups = new Map<string, string[]>();
  for (const p of profiles) {
    const id = dataId(p); if (!id) continue;
    const set = p.data_geography?.boundary_set ?? p.geography.boundary_set;
    groups.set(set, [...(groups.get(set) ?? []), id]);
  }
  // Each part fails on its own: one unavailable list must not blank the others.
  const settle = <T,>(promise: Promise<T>, fallback: T) => promise.catch(e => { if (signal?.aborted) throw e; return fallback; });
  const [census, measures, crime] = await Promise.all([
    Promise.all([...groups].map(([set, ids]) => settle(censusRows(catalog, year, set, ids, signal), { values: {}, source: null }))),
    settle(neighbourhoodMeasures(catalog, profiles, signal), { byPlace: {}, asOf: {}, sources: [] }),
    settle(safety(catalog, profiles, year, signal), { byPlace: {}, source: null }),
  ]);
  const censusValues = Object.assign({}, ...census.map(c => c.values)) as Record<string, CensusShares & Pick<PlaceExtras, "population" | "childrenPct" | "seniorsPct">>;
  const byPlace = Object.fromEntries(profiles.map(p => {
    const id = dataId(p); const g = p.geography.id;
    const values = id ? censusValues[id] : undefined;
    return [g, {
      population: null, childrenPct: null, seniorsPct: null, ...noShares(), ...values,
      ...(measures.byPlace[g] ?? noMeasures()),
      ...(crime.byPlace[g] ?? { safety: null, safetyGap: "Police crime data unavailable" }),
    } satisfies PlaceExtras];
  }));
  const sources = [...new Map([...census.flatMap(c => c.source ? [c.source] : []),
    ...measures.sources, ...(crime.source ? [crime.source] : [])].map(s => [s.id, s])).values()];
  return { byPlace, asOf: measures.asOf, sources };
}
