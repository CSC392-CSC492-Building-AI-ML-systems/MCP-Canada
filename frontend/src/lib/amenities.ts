// Present-day amenities near the selected neighbourhood, for the map. Locations are
// a recent snapshot (not historical), and distances are straight-line estimates.
import type { BoundaryGeometry } from "./boundaries";
import type { LngLat } from "./mapbox";
import type { WalkRoutes } from "./walking";

export type AmenityCategory = "school" | "grocery" | "transit_stop" | "library";
/** Map layers, in chip order. Colours are distinct from the green selection and the
 * orange population shading, and each layer also has its own label in the legend. */
export const AMENITY_LAYERS: { category: AmenityCategory; label: string; color: string }[] = [
  { category: "school", label: "Schools", color: "#3b5bdb" },
  { category: "grocery", label: "Groceries", color: "#a61e4d" },
  { category: "transit_stop", label: "Transit stops", color: "#0b7285" },
  { category: "library", label: "Libraries", color: "#5f3dc4" },
];

/** Only these kinds count, matching the import's neighbourhood counts (NEARBY_CATEGORIES in
 * backend/scripts/prepare_official_data.py): groceries are supermarkets and greengrocers, not
 * convenience stores. Categories not listed keep every place. */
export const COUNTED_KINDS: Partial<Record<AmenityCategory, Set<string>>> = { grocery: new Set(["supermarket", "greengrocer"]) };

/** How far around the neighbourhood places are shown and counted as "nearby". */
export const NEARBY_METRES = 1000;
// Same walking assumptions as the transit commute estimate: 4.8 km/h along streets
// about 1.3 times longer than the straight line.
const WALK_METRES_PER_MINUTE = 4800 / 60;
const WALK_DETOUR = 1.3;

export type Amenity = { category: AmenityCategory; name: string; coordinates: LngLat; validOn: string; kind: string | null };
export type AmenityList = { category: AmenityCategory; loaded: boolean; places: Amenity[]; source: { title: string; publisher: string } | null };

/** Great-circle distance in metres. */
export function distanceMetres([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/** Estimated walking minutes (rounded up, at least 1) for a straight-line distance. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.ceil(metres * WALK_DETOUR / WALK_METRES_PER_MINUTE));
}

/** 100 at the doorstep, falling evenly to 0 at the limit; 0 beyond it. A closer place never scores lower. */
export function distanceScore(metres: number | null, limitMetres = NEARBY_METRES): number | null {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return null;
  return metres >= limitMetres ? 0 : Math.round((1 - metres / limitMetres) * 100);
}

/** "350 m" / "1.2 km" */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** [west, south, east, north] of the area, widened by `metres` on every side. */
export function expandedBbox(geometry: BoundaryGeometry, metres: number): [number, number, number, number] {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0]);
  const points = rings.flat();
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const [west, south, east, north] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos(((south + north) / 2) * Math.PI / 180));
  return [west - dLng, south - dLat, east + dLng, north + dLat];
}

/** A point inside the area to measure distances from: the middle of its bounding box when that
 * falls inside, otherwise the inside point nearest to it (for crescent or L-shaped areas). */
export function interiorPoint(geometry: BoundaryGeometry, contains: (point: LngLat) => boolean): LngLat {
  const [west, south, east, north] = expandedBbox(geometry, 0);
  const centre: LngLat = [(west + east) / 2, (south + north) / 2];
  if (contains(centre)) return centre;
  let best: LngLat | null = null, bestDistance = Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const point: LngLat = [west + (east - west) * i / steps, south + (north - south) * j / steps];
    const d = distanceMetres(point, centre);
    if (d < bestDistance && contains(point)) { best = point; bestDistance = d; }
  }
  return best ?? centre;
}

/** The closest places to `origin`, nearest first. */
export function nearest(places: Amenity[], origin: LngLat, count = 3) {
  return places.map((place) => ({ ...place, metres: distanceMetres(origin, place.coordinates) }))
    .sort((a, b) => a.metres - b.metres || a.name.localeCompare(b.name)).slice(0, count);
}

type PlacesResponse = {
  places: { name: string; latitude: number; longitude: number; valid_on: string; kind: string | null }[];
  sources: { title: string; publisher: string }[];
  category_loaded?: boolean;
};

export async function loadAmenities(category: AmenityCategory, bbox: [number, number, number, number], signal?: AbortSignal): Promise<AmenityList> {
  const response = await fetch(`/api/places/?${new URLSearchParams({ category, bbox: bbox.map((n) => n.toFixed(6)).join(",") })}`, { signal });
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("The backend sent an error page instead of data. Restart the backend and try again.");
  }
  const data: PlacesResponse & { error?: string } = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load nearby places.");
  return {
    category,
    // Older backends omit the flag; then any result proves the list is loaded.
    loaded: data.category_loaded ?? data.places.length > 0,
    places: data.places.filter((p) => !COUNTED_KINDS[category] || (p.kind !== null && COUNTED_KINDS[category]!.has(p.kind)))
      .map((p) => ({ category, name: displayName(p.name), coordinates: [p.longitude, p.latitude], validOn: p.valid_on, kind: p.kind })),
    source: data.sources[0] ? { title: data.sources[0].title, publisher: data.sources[0].publisher } : null,
  };
}

/** How many of the closest places (by straight line) are given a street walking route. */
export const WALK_CANDIDATES = 4;
/** A place to route to. `to` is null when no walk is needed (inside a park). */
export type Candidate = { key: string; name: string; to: LngLat | null; straightMetres: number };
/** A place as shown: by street walking route when one is known, otherwise a labelled estimate. */
export type NearbyPlace = {
  name: string; straightMetres: number;
  /** Walking time and distance along streets and paths, or the straight-line estimate when `estimated`. */
  minutes: number; metres: number; estimated: boolean;
};
/** Street walking routes: still loading, known, or unavailable (no token, Mapbox failed). */
export type Walking = { status: "loading" } | { status: "ok"; routes: WalkRoutes } | { status: "unavailable"; message: string };

/** What the map card and the details panel both show for one kind of place. */
export type NearbySummary =
  | { state: "loading" } | { state: "error"; message: string } | { state: "not_loaded" }
  | { state: "ok"; within: number; nearest: NearbyPlace | null; ranked: NearbyPlace[] };

/** Stable key for a place, shared by the route request, the summary and the map points. */
export const placeKey = (category: string, name: string, [lng, lat]: LngLat) => `${category}|${lng.toFixed(6)},${lat.toFixed(6)}|${name}`;

export function pointCandidates(category: AmenityCategory, list: AmenityList, origin: LngLat, count = WALK_CANDIDATES): Candidate[] {
  return nearest(list.places, origin, count).map((p) => ({ key: placeKey(category, p.name, p.coordinates), name: p.name, to: p.coordinates, straightMetres: p.metres }));
}

/** Order candidates by street walking time. A place with no walking route goes last;
 * when routes are unavailable, every place uses the straight-line estimate, marked as such. */
export function rankByWalking(candidates: Candidate[], walking: Walking): NearbyPlace[] {
  const estimate = (c: Candidate): NearbyPlace => ({ name: c.name, straightMetres: c.straightMetres, minutes: walkMinutes(c.straightMetres), metres: c.straightMetres, estimated: true });
  if (walking.status !== "ok") return candidates.map(estimate);
  const routed: NearbyPlace[] = [], unreachable: NearbyPlace[] = [];
  for (const c of candidates) {
    if (!c.to) {
      // Inside a park needs no walk; anywhere else without a destination point can only be estimated.
      if (c.straightMetres === 0) routed.push({ name: c.name, straightMetres: 0, minutes: 0, metres: 0, estimated: false });
      else unreachable.push(estimate(c));
      continue;
    }
    const walk = walking.routes[c.key];
    if (walk) routed.push({ name: c.name, straightMetres: c.straightMetres, minutes: walk.minutes, metres: walk.metres, estimated: false });
    else unreachable.push(estimate(c));
  }
  return [...routed.sort((a, b) => a.minutes - b.minutes || a.metres - b.metres || a.name.localeCompare(b.name)), ...unreachable];
}

function summary(within: number, candidates: Candidate[], walking: Walking): NearbySummary {
  if (walking.status === "loading" && candidates.some((c) => c.to)) return { state: "loading" };
  const ranked = rankByWalking(candidates, walking);
  return { state: "ok", within, nearest: ranked[0] ?? null, ranked };
}

export function summarizeNearby(result: { list?: AmenityList; error?: string } | undefined, origin: LngLat, walking: Walking): NearbySummary {
  if (!result) return { state: "loading" };
  if (result.error) return { state: "error", message: result.error };
  const list = result.list!;
  if (!list.loaded) return { state: "not_loaded" };
  const within = list.places.filter((p) => distanceMetres(origin, p.coordinates) <= NEARBY_METRES).length;
  return summary(within, pointCandidates(list.category, list, origin), walking);
}

/** Parks are areas, so their distance is measured by the backend to the nearest edge
 * (0 inside a park) rather than to an invented centre point. */
export const PARKS_LAYER = { category: "park" as const, label: "Parks", color: "#2b8a3e" };
export type ParkOutlines = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { park_id: string; name: string; metres: number }>;
export type NearbyParks = {
  loaded: boolean; within: number | null;
  /** Closest parks by distance to their edge, each with the edge point a walk would end at
   * (missing from older backends, which leaves that park as a straight-line estimate). */
  nearest: { name: string; metres: number; point: LngLat | null }[];
  outlines: ParkOutlines; asOf: string | null; source: { title: string; publisher: string } | null;
};

/** "HUMBER ARBORETUM" -> "Humber Arboretum"; the source stores park names in capitals. */
export function displayName(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s\-'(/.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()) : name;
}

export async function loadNearbyParks(origin: LngLat, bbox: [number, number, number, number], signal?: AbortSignal): Promise<NearbyParks> {
  const query = new URLSearchParams({ longitude: origin[0].toFixed(6), latitude: origin[1].toFixed(6), bbox: bbox.map((n) => n.toFixed(6)).join(",") });
  const response = await fetch(`/api/parks/nearby/?${query}`, { signal });
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error("The backend sent an error page instead of data. Restart the backend and try again.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load nearby parks.");
  return {
    loaded: data.category_loaded, within: data.within_1km,
    nearest: data.nearest.map((p: { name: string; metres: number; point?: LngLat }) => ({ name: displayName(p.name), metres: p.metres, point: p.point ?? null })),
    outlines: data.features, asOf: data.as_of, source: data.source,
  };
}

/** Walks to a park end at the closest point on its edge; inside a park no walk is needed. */
export function parkCandidates(parks: NearbyParks): Candidate[] {
  return parks.nearest.map((p) => ({ key: p.point ? placeKey("park", p.name, p.point) : `park|${p.name}`, name: p.name,
    to: p.metres === 0 ? null : p.point, straightMetres: p.metres }));
}

export function summarizeParks(result: { parks?: NearbyParks; error?: string } | undefined, walking: Walking): NearbySummary {
  if (!result) return { state: "loading" };
  if (result.error) return { state: "error", message: result.error };
  const parks = result.parks!;
  if (!parks.loaded) return { state: "not_loaded" };
  return summary(parks.within ?? 0, parkCandidates(parks), walking);
}

/** "6 min walk · 450 m by street", or a clearly marked straight-line estimate. */
export function placeText(p: NearbyPlace): string {
  if (!p.estimated && p.metres === 0) return "You are in it";
  return p.estimated ? `~${p.minutes} min walk (estimate) · ${formatDistance(p.straightMetres)} straight line`
    : `${p.minutes} min walk · ${formatDistance(p.metres)} by street`;
}
