export type BoundarySet = {
  id: string; label: string; years: number[];
  neighbourhoods: { id: string; name: string; code: string }[];
};
export type ExplorationSelection = { boundarySetId: string; geographyId: string; year: number };
export type Measurement = {
  value: string | null; status: string; reason: string;
  label?: string; unit?: string; statistic?: string; universe?: string;
  census_year?: number; reference_year?: number; source_locator?: string;
  source: { id: string; title: string; publisher: string; url: string; coverage: string } | null;
};
export type NeighbourhoodProfile = {
  geography: { id: string; name: string; code: string; boundary_set: string; boundary_version: string };
  year: number; available_years: number[];
  /** Set when the values come from the same, unchanged area in another boundary set. */
  data_geography?: { id: string; name: string; boundary_set: string };
  metrics: { cost: Measurement; income: Measurement; burden: Measurement };
  history: { year: number; cost: Measurement }[];
  method: { housing: string; comparison: string; income: string; inflation: string; release_selection: string };
};
