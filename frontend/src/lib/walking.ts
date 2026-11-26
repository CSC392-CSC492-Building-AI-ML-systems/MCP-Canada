// Street walking times from one point to nearby places, from the Mapbox Matrix API
// (walking profile: streets, paths and crossings, not a straight line):
// https://docs.mapbox.com/api/navigation/matrix/
// Same API and limits as the commute times in routing.ts (PR #29); this is the
// one-origin-to-many-places direction.
import { MAPBOX_TOKEN, type LngLat } from "./mapbox";

export type Walk = { minutes: number; metres: number };
/** By destination key; null when Mapbox found no walking route to that place. */
export type WalkRoutes = Record<string, Walk | null>;
export type WalkDestination = { key: string; coordinates: LngLat };

export const WALK_SOURCE = { title: "Mapbox Matrix API, walking routes", publisher: "Mapbox, road data © OpenStreetMap contributors" };
// 25 coordinates per Matrix request; one of them is the origin.
const MAX_DESTINATIONS = 24;
const cache = new Map<string, Walk | null>();
const at = ([lng, lat]: LngLat) => `${lng.toFixed(6)},${lat.toFixed(6)}`;

export class WalkingUnavailable extends Error {}

type MatrixResponse = { code: string; message?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };

/** Walking time and street distance from `origin` to each destination. Results are kept
 * for the visit, so reselecting a neighbourhood does not ask Mapbox again. */
export async function walkingRoutes(origin: LngLat, destinations: WalkDestination[], signal?: AbortSignal): Promise<WalkRoutes> {
  if (!MAPBOX_TOKEN) throw new WalkingUnavailable("Street walking times need a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN).");
  const routes: WalkRoutes = {};
  const missing: WalkDestination[] = [];
  for (const d of destinations) {
    const cached = cache.get(`${at(origin)}>${at(d.coordinates)}`);
    if (cached !== undefined) routes[d.key] = cached; else missing.push(d);
  }
  for (let start = 0; start < missing.length; start += MAX_DESTINATIONS) {
    const batch = missing.slice(start, start + MAX_DESTINATIONS);
    const coordinates = [origin, ...batch.map((d) => d.coordinates)].map(at).join(";");
    const params = new URLSearchParams({
      sources: "0", destinations: batch.map((_, i) => i + 1).join(";"),
      annotations: "duration,distance", access_token: MAPBOX_TOKEN,
    });
    const response = await fetch(`https://api.mapbox.com/directions-matrix/v1/mapbox/walking/${coordinates}?${params}`, { signal });
    const data: MatrixResponse = await response.json().catch(() => ({ code: "InvalidResponse" }));
    if (!response.ok || data.code !== "Ok") throw new WalkingUnavailable(`Mapbox could not calculate walking times (${data.message ?? data.code ?? response.status}).`);
    batch.forEach((d, i) => {
      const seconds = data.durations?.[0]?.[i] ?? null;
      const metres = data.distances?.[0]?.[i] ?? null;
      const walk = seconds === null || metres === null ? null : { minutes: Math.max(1, Math.round(seconds / 60)), metres: Math.round(metres) };
      cache.set(`${at(origin)}>${at(d.coordinates)}`, walk);
      routes[d.key] = walk;
    });
  }
  return routes;
}

/** Forget remembered routes (tests only). */
export function clearWalkingCache() { cache.clear(); }
