/** Frontend adapter over the existing catalog and observations APIs.
 * No writes, new endpoints, inferred boundary joins, or source substitutions.
 * The one cross-set link is exact: the comparison table uses a neighbourhood with
 * the same code and name in both sets (boundaries unchanged in 2021).
 */
import type { BoundarySet, Measurement, NeighbourhoodProfile } from './types';
type Source = NonNullable<Measurement['source']>;
type Indicator = { id: string; label: string; unit: string; universe: string; statistic: string };
export type Catalog = {
  sources: Source[]; indicators: Indicator[];
  geographies: {id: string; name: string; code: string; geography_set_id: string; geography_set__kind: string; geography_set__version: string}[];
};
type RawObservation = {value: string | null; status: string; census_year: number | null; reference_year: number; source_locator: string; period: string};
// Exact reviewed row IDs from the imported Census snapshots, not label guesses.
const rows: Record<number, Record<'cost' | 'income' | 'burden', number | null>> = {
  2001: {cost:742,income:523,burden:743}, 2006:{cost:1198,income:577,burden:1199},
  2011:{cost:1366,income:757,burden:1365}, 2016:{cost:null,income:1020,burden:1695},
  2021:{cost:380,income:245,burden:378},
};
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url,{signal});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load neighbourhood data.');
  return data;
}
export async function loadWorkspaceData(signal?: AbortSignal) {
  const catalog = await getJson<Catalog>('/api/catalog/',signal);
  const boundary_sets: BoundarySet[] = [];
  for (const [id, label, candidates] of [
    ['toronto-140','Historical 140',[2001,2006,2011,2016]],
    ['toronto-158','Current 158',[2021]],
  ] as const) {
    const neighbourhoods=catalog.geographies.filter(g=>g.geography_set_id===id).map(g=>({id:g.id,name:g.name,code:g.code}));
    const years=candidates.filter(y=>catalog.indicators.some(i=>i.id.startsWith(`census-${y}-row-`)));
    if (neighbourhoods.length && years.length) boundary_sets.push({id,label,years,neighbourhoods});
  }
  return {catalog,boundary_sets};
}
const setForYear = (year: number) => year === 2021 ? 'toronto-158' : 'toronto-140';

/** Census years that can be compared, across both Toronto boundary sets. */
export function comparisonYears(sets: BoundarySet[]) {
  return [...new Set(sets.filter(s => s.id === 'toronto-140' || s.id === 'toronto-158').flatMap(s => s.years))].sort((a, b) => a - b);
}

/** Same code and same name in both sets: one of the 124 neighbourhoods the City left unchanged in 2021. */
function unchangedCounterpart(catalog: Catalog, geography: Catalog['geographies'][number], setId: string) {
  return catalog.geographies.find(g => g.geography_set_id === setId && g.code === geography.code
    && g.name.trim().toLowerCase() === geography.name.trim().toLowerCase());
}

/** Profile for the comparison table. For a year published on the other boundary set,
 * an unchanged neighbourhood uses its exact counterpart; a split neighbourhood shows unavailable values. */
export async function loadComparisonProfile(catalog: Catalog, geographyId: string, year: number, signal?: AbortSignal): Promise<NeighbourhoodProfile> {
  const geography = catalog.geographies.find(g => g.id === geographyId);
  if (!geography) throw new Error('Choose a valid neighbourhood and Census year.');
  const target = setForYear(year);
  if (geography.geography_set_id === target) return loadProfile(catalog, geographyId, year, signal);
  const own = {id: geography.id, name: geography.name, code: geography.code, boundary_set: geography.geography_set_id, boundary_version: geography.geography_set__version};
  const counterpart = unchangedCounterpart(catalog, geography, target);
  if (counterpart) {
    const profile = await loadProfile(catalog, counterpart.id, year, signal);
    return {...profile, geography: own, data_geography: {id: counterpart.id, name: counterpart.name, boundary_set: target}};
  }
  const missing: Measurement = {value: null, status: 'missing', source: null,
    reason: `This neighbourhood's boundaries changed in 2021, so no ${year} Census value exists for this exact area.`};
  return {geography: own, year, available_years: [], metrics: {cost: missing, income: missing, burden: missing}, history: [],
    method: {release_selection: '', housing: '', income: '', inflation: '',
      comparison: 'Only neighbourhoods with unchanged boundaries are compared across boundary sets.'}};
}

export async function loadProfile(catalog: Catalog, geographyId: string, year: number, signal?: AbortSignal): Promise<NeighbourhoodProfile> {
  const geography=catalog.geographies.find(g=>g.id===geographyId);
  if (!geography || !(year in rows)) throw new Error('Choose a valid neighbourhood and Census year.');
  const years=(geography.geography_set_id==='toronto-158'?[2021]:[2001,2006,2011,2016])
    .filter(y=>catalog.indicators.some(i=>i.id.startsWith(`census-${y}-row-`)));
  if (!years.includes(year)) throw new Error('This year is unavailable on the selected boundary set.');
  const pending = new Map<string,Promise<Measurement>>();
  function measurement(y:number,key:'cost'|'income'|'burden'):Promise<Measurement> {
    const id=`census-${y}-row-${rows[y][key]}`;
    if (pending.has(id)) return pending.get(id)!;
    const request=(async():Promise<Measurement>=>{
      const indicator=catalog.indicators.find(i=>i.id===id);
      // The original import generates census-YEAR-* release IDs. Multiple releases
      // require an explicit reviewed choice rather than silently selecting one.
      const sources=catalog.sources.filter(s=>s.id.startsWith(`census-${y}-`));
      const missing:Measurement={value:null,status:'missing',reason:'No verified value is loaded for this measure and period.',source:null};
      if (!indicator) return missing;
      if (sources.length!==1) return {...missing,reason:'A unique reviewed Census release is not available.'};
      const source=sources[0];
      const query=new URLSearchParams({geography_id:geographyId,indicator_id:id,source_id:source.id});
      const result=await getJson<{observations:RawObservation[]}>(`/api/observations/?${query}`,signal);
      const values=result.observations.filter(o=>o.census_year===y && o.period==='annual');
      if (values.length!==1) return {...missing,reason:'No unique published observation is available.'};
      const observation=values[0];
      return {...observation,census_year:y,label:indicator.label,unit:indicator.unit,statistic:indicator.statistic,universe:indicator.universe,source,
        reason:observation.status==='observed'?'':'The published source cell is unavailable or suppressed.'};
    })();
    pending.set(id,request);return request;
  }
  const [cost,income,burden,history]=await Promise.all([
    measurement(year,'cost'),measurement(year,'income'),measurement(year,'burden'),
    Promise.all(years.map(async y=>({year:y,cost:await measurement(y,'cost')}))),
  ]);
  return {geography:{id:geography.id,name:geography.name,code:geography.code,boundary_set:geography.geography_set_id,boundary_version:geography.geography_set__version},
    year,available_years:years,metrics:{cost,income,burden},history,
    method:{
      release_selection:'Each indicator uses the single reviewed Census release present in the catalogue. Multiple releases are treated as unavailable until a release is selected explicitly.',
      housing:'Census renter shelter costs include rent and applicable utilities. They are not advertised asking rents and are not bedroom-specific.',
      comparison:'One boundary set is retained across the timeline. Unavailable years are never filled or mapped from another boundary set.',
      income:'Published household income is contextual. Personal affordability uses only the income you enter.',
      inflation:'All dollar values shown here are nominal (not inflation-adjusted).',
    }};
}
