// Total population for every neighbourhood in one boundary set and Census year,
// used to shade the map. Values come only from the reviewed rows below; a
// missing or suppressed value stays null (unknown), never zero.

// Reviewed Census row IDs for total population in each year's City of Toronto
// neighbourhood profile. 2001-2016 are full counts ("Population, YEAR").
// 2021 has no full-count row; its first total comes from 25% sample data,
// so it carries a note wherever it is shown.
export const POPULATION_ROWS: Record<number, { row: number; note?: string }> = {
  2001: { row: 3 },
  2006: { row: 3 },
  2011: { row: 2 },
  2016: { row: 4 },
  2021: { row: 4, note: "2021: estimated from 25% sample data, not a full count." },
};

// Map shading. Fixed bands for every year, so a colour means the same number of
// people in 2001 and 2021. One orange hue, light to dark (validated for step
// separation and contrast); blue would blur into the lake, green is the selection.
export const POPULATION_SCALE = {
  breaks: [10_000, 15_000, 20_000, 30_000],
  colors: ["#ef9f74", "#e3773f", "#c95a22", "#9c4316", "#6a2c0c"],
  labels: ["Under 10k", "10k–15k", "15k–20k", "20k–30k", "30k and over"],
  noData: "#c9c9c2",
};

export type PopulationLayer = {
  year: number;
  values: Record<string, number | null>; // geography id -> people, null if unknown
  note?: string;
  source: { title: string; publisher: string };
};

type Catalog = { sources: { id: string; title: string; publisher: string }[] };
type Row = { geography_id: string; value: string | null; status: string; census_year: number | null };

let catalogRequest: Promise<Catalog> | null = null;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load population data.");
  return data;
}

export async function loadPopulation(boundarySetId: string, year: number, signal?: AbortSignal): Promise<PopulationLayer> {
  const reviewed = POPULATION_ROWS[year];
  if (!reviewed) throw new Error(`No reviewed population row for ${year}.`);
  // The catalogue lists every source; fetched once and shared across years.
  catalogRequest ??= getJson<Catalog>("/api/catalog/").catch((e) => { catalogRequest = null; throw e; });
  const catalog = await catalogRequest;
  // Same rule as the housing panel: exactly one imported release per Census year.
  const sources = catalog.sources.filter((s) => s.id.startsWith(`census-${year}-`));
  if (sources.length !== 1) throw new Error(`A unique reviewed ${year} Census release is not available.`);
  const query = new URLSearchParams({
    indicator_id: `census-${year}-row-${reviewed.row}`,
    source_id: sources[0].id,
    geography_set_id: boundarySetId,
  });
  const { observations } = await getJson<{ observations: Row[] }>(`/api/observations/?${query}`, signal);
  const values: Record<string, number | null> = {};
  for (const o of observations) {
    if (o.census_year !== year) continue;
    values[o.geography_id] = o.status === "observed" && o.value !== null ? Number(o.value) : null;
  }
  return { year, values, note: reviewed.note, source: { title: sources[0].title, publisher: sources[0].publisher } };
}
