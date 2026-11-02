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

function polygons(geometry: BoundaryGeometry): Ring[][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

// Ray casting: count how many edges a ray from the point crosses.
function inRing([x, y]: LngLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The neighbourhood containing the point, if any. Each polygon's first ring
 * is its outer edge and the rest are holes. */
export function findBoundary(boundaries: Boundaries, point: LngLat): Boundaries["features"][number] | undefined {
  return boundaries.features.find((f) =>
    polygons(f.geometry).some(([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h))));
}

/** [south-west, north-east] corners around the outer rings. */
export function boundsOf(geometry: BoundaryGeometry): [LngLat, LngLat] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons(geometry)) for (const [x, y] of polygon[0]) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}
