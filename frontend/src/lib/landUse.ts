// Zoning in the selected neighbourhood, for the map's "Land use" layer. Zoning (City of
// Toronto By-law 569-2013) is what land is zoned for, not what is built there today, and it
// is a present-day snapshot (amendments to June 18, 2023), not historical.

/** Categories in legend order. Colours avoid the green selection, the orange population
 * shading and the amenity point colours, and the legend always names each one. */
export const LAND_USE_CATEGORIES = [
  { category: "residential", label: "Residential", color: "#f4d35e" },
  { category: "residential_apartment", label: "Residential apartment", color: "#ee964b" },
  { category: "commercial_residential", label: "Commercial residential (mixed use)", color: "#e36397" },
  { category: "commercial", label: "Commercial", color: "#c1121f" },
  { category: "commercial_residential_employment", label: "Commercial, residential and employment", color: "#c77dff" },
  { category: "employment", label: "Employment industrial", color: "#5a189a" },
  { category: "institutional", label: "Institutional", color: "#3a86ff" },
  { category: "open_space", label: "Open space", color: "#2d6a4f" },
  { category: "utility_transportation", label: "Utility and transportation", color: "#8d99ae" },
  // Not a zone: large City parks (e.g. High Park) are missing from the zoning file, so unzoned
  // land that is a City park in the Green Spaces snapshot is shown as such, from that source.
  { category: "unzoned_park", label: "City park, not in the zoning file", color: "#95d5b2" },
] as const;
export type LandUseCategory = (typeof LAND_USE_CATEGORIES)[number]["category"];

export type LandUse = {
  loaded: boolean;
  features: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { category: LandUseCategory; label: string; zone: string }>;
  /** Share of the neighbourhood's area per category, largest first. */
  shares: { category: LandUseCategory; label: string; percent: number }[];
  /** Area with no zone in the file: roads, rail, water, lands under former by-laws. */
  notCoveredPercent: number | null;
  asOf: string | null;
  source: { title: string; publisher: string } | null;
  /** Set when unzoned City parks were identified from the Green Spaces snapshot. */
  parkSource: { title: string; publisher: string } | null;
};

export async function loadLandUse(geographyId: string, signal?: AbortSignal): Promise<LandUse> {
  const response = await fetch(`/api/land-use/?${new URLSearchParams({ geography_id: geographyId })}`, { signal });
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("The backend sent an error page instead of data. Restart the backend and try again.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load zoning.");
  return { loaded: data.category_loaded, features: data.features, shares: data.shares,
    notCoveredPercent: data.not_covered_percent, asOf: data.as_of, source: data.source, parkSource: data.park_source ?? null };
}

/** "61%", or "<1%" for a small but real share. */
export const formatShare = (percent: number) => percent > 0 && percent < 0.5 ? "<1%" : `${percent.toFixed(0)}%`;

export const landUseColor = (category: string) => LAND_USE_CATEGORIES.find((c) => c.category === category)?.color ?? "#495057";
