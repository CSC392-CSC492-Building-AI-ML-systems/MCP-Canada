// Neighbourhood boundaries for one boundary set at a time.
import type { LngLat } from "./mapbox";

type Ring = LngLat[];
export type BoundaryGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };
export type Boundaries = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: BoundaryGeometry;
    properties: { geography_id: string; code: string; name: string };
  }[];
};

export async function loadBoundaries(boundarySetId: string, signal?: AbortSignal): Promise<Boundaries> {
  const response = await fetch(`/api/boundaries/?${new URLSearchParams({ geography_set_id: boundarySetId })}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load neighbourhood boundaries.");
  return data;
}

/** [south-west, north-east] corners around the outer rings. */
export function boundsOf(geometry: BoundaryGeometry): [LngLat, LngLat] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const [x, y] of polygon[0]) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}
