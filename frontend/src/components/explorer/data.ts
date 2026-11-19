/** Frontend adapter over the catalog and observations APIs.
 *
 * Toronto has two neighbourhood boundary sets: Historical 140 (Census 2001–2016)
 * and Current 158 (Census 2021). The backend links them exactly (every 2021 area
 * lies inside one earlier area; `boundary_links` in the catalog):
 * - On Historical 140, 2021 values are the identical area's published value, or
 *   for areas split in 2021, combined from their parts by the backend (counts
 *   summed, averages weighted; medians never combined).
 * - On Current 158, earlier years are shown only for the 124 unchanged areas,
 *   from the identical earlier area. A split area has no earlier value of its own.
 * Values are never estimated, interpolated or filled.
 */
import type { BoundarySet, Measurement, NeighbourhoodProfile } from './types';
type Source = NonNullable<Measurement['source']>;
type Indicator = { id: string; label: string; unit: string; universe: string; statistic: string };
export type BoundaryLink = { id: string; parent: string; relation: 'same' | 'part' };
export type Catalog = {
  sources: Source[]; indicators: Indicator[];
  geographies: {id: string; name: string; code: string; geography_set_id: string; geography_set__kind: string; geography_set__version: string}[];
  /** 2021 (158) neighbourhood -> the earlier (140) neighbourhood containing it. Absent on older backends. */
  boundary_links?: BoundaryLink[];
};
type RawObservation = {value: string | null; status: string; census_year: number | null; reference_year: number; source_locator: string; period: string; derived?: Measurement['derived']};
export type MetricKey = 'cost' | 'income' | 'burden' | 'population';
/** Exact reviewed row IDs from the imported Census snapshots, not label guesses.
 * Cost and income are averages in every year so that periods share one definition
 * (and so 2021 can be combined for areas split in 2021; a median cannot be).
 * Renter shelter cost was called "average gross rent" in 2001 and 2006; the City's
 * 2016 profile does not publish it. */
const rows: Record<number, Record<MetricKey, number | null>> = {
  2001: {cost: 742, income: 522, burden: 743, population: 3},
  2006: {cost: 1198, income: 578, burden: 1199, population: 3},
  2011: {cost: 1367, income: 758, burden: 1365, population: 2},
  2016: {cost: null, income: 1029, burden: 1695, population: 4},
  2021: {cost: 381, income: 246, burden: 378, population: 4},
};
const HISTORICAL = 'toronto-140', CURRENT = 'toronto-158';
const nativeSet = (year: number) => year === 2021 ? CURRENT : HISTORICAL;
const hasCensus = (catalog: Catalog, year: number) => catalog.indicators.some(i => i.id.startsWith(`census-${year}-row-`));

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url,{signal});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load neighbourhood data.');
  return data;
}

/** The backend's links, or (older backend) only the unchanged areas: same code and same name. */
function boundaryLinks(catalog: Catalog): Map<string, BoundaryLink> {
  if (catalog.boundary_links?.length) return new Map(catalog.boundary_links.map(link => [link.id, link]));
  const earlier = new Map(catalog.geographies.filter(g => g.geography_set_id === HISTORICAL).map(g => [`${g.code}|${g.name.trim().toLowerCase()}`, g.id]));
  const links = new Map<string, BoundaryLink>();
  for (const g of catalog.geographies.filter(g => g.geography_set_id === CURRENT)) {
    const parent = earlier.get(`${g.code}|${g.name.trim().toLowerCase()}`);
    if (parent) links.set(g.id, {id: g.id, parent, relation: 'same'});
  }
  return links;
}

/** Census years shown on a boundary set's timeline. */
export function boundarySetYears(catalog: Catalog, setId: string): number[] {
  return Object.keys(rows).map(Number).filter(year => hasCensus(catalog, year) && (
    nativeSet(year) === setId
    // The earlier boundaries need the backend to combine 2021 values; the current ones
    // show earlier years for their unchanged areas.
    || (setId === HISTORICAL && !!catalog.boundary_links?.length)
    || setId === CURRENT));
}

export async function loadWorkspaceData(signal?: AbortSignal) {
  const catalog = await getJson<Catalog>('/api/catalog/',signal);
  const boundary_sets: BoundarySet[] = [];
  for (const [id, label] of [[HISTORICAL, 'Historical 140'], [CURRENT, 'Current 158']] as const) {
    const neighbourhoods=catalog.geographies.filter(g=>g.geography_set_id===id).map(g=>({id:g.id,name:g.name,code:g.code}));
    const years=boundarySetYears(catalog, id);
    if (neighbourhoods.length && years.length) boundary_sets.push({id,label,years,neighbourhoods});
  }
  return {catalog,boundary_sets};
}

/** Census years that can be compared, across both Toronto boundary sets. */
export function comparisonYears(sets: BoundarySet[]) {
  return [...new Set(sets.filter(s => s.id === HISTORICAL || s.id === CURRENT).flatMap(s => s.years))].sort((a, b) => a - b);
}

type DataArea = { id: string; data_geography?: NeighbourhoodProfile['data_geography'] } | { missing: string };
/** Which published area holds a neighbourhood's values for a year, or why none does. */
export function dataAreaFor(catalog: Catalog, geographyId: string, year: number): DataArea {
  const geography = catalog.geographies.find(g => g.id === geographyId);
  if (!geography || !hasCensus(catalog, year)) return {missing: `No ${year} Census data is loaded.`};
  const set = geography.geography_set_id;
  if (set === nativeSet(year)) return {id: geography.id};
  if (set === HISTORICAL) return catalog.boundary_links?.length ? {id: geography.id}
    : {missing: '2021 values for the earlier boundaries are not available from this server.'};
  const link = boundaryLinks(catalog).get(geography.id);
  const parent = link && catalog.geographies.find(g => g.id === link.parent);
  if (link?.relation === 'same' && parent) return {id: parent.id, data_geography: {id: parent.id, name: parent.name, boundary_set: HISTORICAL}};
  if (parent) return {missing: `Before 2021 this area was part of ${parent.name}, so the ${year} Census has no value for it alone. Switch to the Historical 140 boundaries to follow ${parent.name} from 2001 to 2021.`};
  return {missing: `This neighbourhood's boundaries changed in 2021, so no ${year} Census value exists for this exact area.`};
}

/** Plain-language note about how this neighbourhood's boundary changed in 2021, if it did. */
function boundaryNote(catalog: Catalog, geographyId: string): string | undefined {
  const links = boundaryLinks(catalog);
  const name = (id: string) => catalog.geographies.find(g => g.id === id)?.name ?? id;
  const own = links.get(geographyId);
  if (own?.relation === 'part') return `In 2021 the City split ${name(own.parent)} into smaller neighbourhoods; this is one of them. Earlier Census years describe the larger area only.`;
  const parts = [...links.values()].filter(l => l.parent === geographyId && l.relation === 'part').map(l => name(l.id));
  if (parts.length) return `In 2021 the City split this neighbourhood into ${parts.join(', ')}. Its 2021 values combine those parts where the Census allows: counts are added and averages are weighted. Medians cannot be combined and are shown as unavailable.`;
  return undefined;
}

/** Kept for the comparison page; one loader now handles every boundary set and year. */
export const loadComparisonProfile = loadProfile;

export async function loadProfile(catalog: Catalog, geographyId: string, year: number, signal?: AbortSignal): Promise<NeighbourhoodProfile> {
  const geography=catalog.geographies.find(g=>g.id===geographyId);
  if (!geography || !(year in rows)) throw new Error('Choose a valid neighbourhood and Census year.');
  const years=boundarySetYears(catalog, geography.geography_set_id);
  if (!years.includes(year)) throw new Error('This year is unavailable on the selected boundary set.');
  const areas = new Map(years.map(y => [y, dataAreaFor(catalog, geographyId, y)]));
  const available_years = years.filter(y => !('missing' in areas.get(y)!));
  const pending = new Map<string,Promise<Measurement>>();
  function measurement(y:number,key:MetricKey):Promise<Measurement> {
    const area = areas.get(y)!;
    if ('missing' in area) return Promise.resolve({value: null, status: 'missing', source: null, reason: area.missing});
    const id=`census-${y}-row-${rows[y][key]}`;
    const cacheKey=`${area.id}|${id}`;
    if (pending.has(cacheKey)) return pending.get(cacheKey)!;
    const request=(async():Promise<Measurement>=>{
      const indicator=catalog.indicators.find(i=>i.id===id);
      // The original import generates census-YEAR-* release IDs. Multiple releases
      // require an explicit reviewed choice rather than silently selecting one.
      const sources=catalog.sources.filter(s=>s.id.startsWith(`census-${y}-`));
      const missing:Measurement={value:null,status:'missing',reason:rows[y][key] === null ? `The ${y} Census profile does not publish this measure for neighbourhoods.` : 'No verified value is loaded for this measure and period.',source:null};
      if (!indicator) return missing;
      if (sources.length!==1) return {...missing,reason:'A unique reviewed Census release is not available.'};
      const source=sources[0];
      const query=new URLSearchParams({geography_id:area.id,indicator_id:id,source_id:source.id});
      const result=await getJson<{observations:RawObservation[]}>(`/api/observations/?${query}`,signal);
      const values=result.observations.filter(o=>o.census_year===y && o.period==='annual');
      if (values.length!==1) return {...missing,reason:'No unique published observation is available.'};
      const observation=values[0];
      return {...observation,census_year:y,label:indicator.label,unit:indicator.unit,statistic:indicator.statistic,universe:indicator.universe,source,
        reason:observation.status==='observed'?'':observation.derived?.method ?? 'The published source cell is unavailable or suppressed.'};
    })();
    pending.set(cacheKey,request);return request;
  }
  const metric = (y: number) => Promise.all((['cost','income','burden','population'] as const).map(key => measurement(y, key)))
    .then(([cost, income, burden, population]) => ({cost, income, burden, population}));
  const [metrics, history] = await Promise.all([
    metric(year),
    Promise.all(available_years.map(async y => ({year: y, ...await metric(y)}))),
  ]);
  const selected = areas.get(year)!;
  return {geography:{id:geography.id,name:geography.name,code:geography.code,boundary_set:geography.geography_set_id,boundary_version:geography.geography_set__version},
    year,available_years,metrics,history,
    ...('data_geography' in selected && selected.data_geography ? {data_geography: selected.data_geography} : {}),
    boundary_note: boundaryNote(catalog, geographyId),
    method:{
      release_selection:'Each indicator uses the single reviewed Census release present in the catalogue. Multiple releases are treated as unavailable until a release is selected explicitly.',
      housing:'Average monthly shelter cost for renter households: rent plus applicable utilities (called "gross rent" in the 2001 and 2006 Census). The same average is used in every year; the 2016 neighbourhood profile does not publish it. These are not advertised asking rents.',
      comparison:'One neighbourhood boundary is used for every period. On the Historical 140 boundaries, 2021 values come from the identical 2021 area or, for areas split in 2021, combine their parts (counts added, averages weighted by the households they describe). On the Current 158 boundaries, earlier years appear only for areas whose boundary did not change. Unavailable years are never filled.',
      income:'Average before-tax household income for the calendar year before each Census. Personal affordability uses only the income you enter.',
      inflation:'All dollar values shown here are nominal (not inflation-adjusted).',
      population:'Population is the 100% count for 2001–2016 and the 25% sample total for 2021. The 2011 values come from the voluntary National Household Survey, except population.',
    }};
}
