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

/** The neighbourhood in `target` containing the centre of `geographyId` in `source`.
 * This is a nearest place on the map; the two areas are not statistically equivalent. */
export function findAtSameLocation(source: Boundaries, geographyId: string, target: Boundaries): Boundaries["features"][number] | undefined {
  const feature = source.features.find((f) => f.properties.geography_id === geographyId);
  if (!feature) return undefined;
  const [[west, south], [east, north]] = boundsOf(feature.geometry);
  return findBoundary(target, [(west + east) / 2, (south + north) / 2]);
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

/** A point inside the area to route from: the centroid of its largest polygon, or, when that
 * falls outside (a crescent-shaped area), the middle of the widest stretch of polygon on the
 * centroid's line of latitude. */
export function representativePoint(geometry: BoundaryGeometry): LngLat {
  const polygon = polygons(geometry).reduce((a, b) => Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a);
  const outer = polygon[0];
  const area = ringArea(outer);
  let cx = 0, cy = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    cx += (outer[j][0] + outer[i][0]) * cross; cy += (outer[j][1] + outer[i][1]) * cross;
  }
  const centroid: LngLat = area ? [cx / (6 * area), cy / (6 * area)] : outer[0];
  const inside = (p: LngLat) => inRing(p, outer) && !polygon.slice(1).some(h => inRing(p, h));
  if (inside(centroid)) return centroid;
  const y = centroid[1];
  const xs: number[] = [];
  for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  let best: LngLat = outer[0], width = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > width) { width = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
  return best;
}
