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
  /** Set when the backend derived a 2021 value for an earlier (140) boundary from the 2021 areas. */
  derived?: { relation: 'same' | 'combined' | 'not_combined'; method: string; parts: string[] };
};
export type ProfileMetrics = { cost: Measurement; income: Measurement; burden: Measurement; population: Measurement };
export type NeighbourhoodProfile = {
  geography: { id: string; name: string; code: string; boundary_set: string; boundary_version: string };
  year: number; available_years: number[];
  /** Set when the values come from the same, unchanged area in another boundary set. */
  data_geography?: { id: string; name: string; boundary_set: string };
  /** How this neighbourhood's boundary changed in 2021, when it did. */
  boundary_note?: string;
  metrics: ProfileMetrics;
  history: ({ year: number } & ProfileMetrics)[];
  method: { housing: string; comparison: string; income: string; inflation: string; release_selection: string; population?: string };
};
