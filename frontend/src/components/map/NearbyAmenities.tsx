"use client";
import { useEffect, useMemo, useState } from "react";
import { AMENITY_LAYERS, distanceMetres, expandedBbox, interiorPoint, loadAmenities, loadNearbyParks, NEARBY_METRES, placeKey,
  type AmenityCategory, type AmenityList, type Candidate, type NearbyParks, type Walking } from "@/lib/amenities";
import { walkingRoutes } from "@/lib/walking";
import { findBoundary, type Boundaries } from "@/lib/boundaries";
import type { LngLat } from "@/lib/mapbox";

type Feature = Boundaries["features"][number];
export type NearbyOrigin = { point: LngLat; label: string };
type Result = { key: string; list?: AmenityList; error?: string };

/** Where distances are measured from: the searched address when it lies in the
 * neighbourhood, otherwise a point inside the neighbourhood. */
export function nearbyOrigin(feature: Feature, searched: LngLat | null): NearbyOrigin {
  const area: Boundaries = { type: "FeatureCollection", features: [feature] };
  if (searched && findBoundary(area, searched)) return { point: searched, label: "your searched address" };
  return { point: interiorPoint(feature.geometry, (p) => !!findBoundary(area, p)), label: `the centre of ${feature.properties.name}` };
}

/** Places of each enabled category around the neighbourhood (its area plus 1 km). */
export function useNearbyAmenities(feature: Feature | undefined, enabled: AmenityCategory[]) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const areaId = feature?.properties.geography_id;
  const wanted = enabled.join(",");
  useEffect(() => {
    if (!feature || !wanted) return;
    const abort = new AbortController();
    const bbox = expandedBbox(feature.geometry, NEARBY_METRES);
    for (const category of wanted.split(",") as AmenityCategory[]) {
      const key = `${feature.properties.geography_id}:${category}`;
      loadAmenities(category, bbox, abort.signal)
        .then((list) => setResults((r) => ({ ...r, [category]: { key, list } })))
        .catch((e) => { if (!abort.signal.aborted) setResults((r) => ({ ...r, [category]: { key, error: e.message } })); });
    }
    return () => abort.abort();
    // The feature object is replaced when boundaries reload; its id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, wanted]);
  // Only results for the neighbourhood on screen; a stale one shows as loading.
  return useMemo(() => Object.fromEntries(enabled.map((category) => {
    const result = results[category];
    return [category, result && result.key === `${areaId}:${category}` ? result : undefined];
  })) as Record<AmenityCategory, Result | undefined>, [results, enabled, areaId]);
}

export type ParksResult = { key: string; parks?: NearbyParks; error?: string };
/** Parks around the neighbourhood, measured from the origin to each park's edge. */
export function useNearbyParks(feature: Feature | undefined, origin: NearbyOrigin | null): ParksResult | undefined {
  const [result, setResult] = useState<ParksResult | undefined>();
  const key = feature && origin ? `${feature.properties.geography_id}:${origin.point.join(",")}` : "";
  useEffect(() => {
    if (!feature || !origin) return;
    const abort = new AbortController();
    loadNearbyParks(origin.point, expandedBbox(feature.geometry, NEARBY_METRES), abort.signal)
      .then((parks) => setResult({ key, parks }))
      .catch((e) => { if (!abort.signal.aborted) setResult({ key, error: e.message }); });
    return () => abort.abort();
    // The key captures the area and origin; the objects are rebuilt on every boundary reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result?.key === key ? result : undefined;
}

export type WalkingState = { key: string; walking: Walking };
/** Street walking routes from the origin to every candidate, from Mapbox. */
export function useWalkingRoutes(origin: NearbyOrigin | null, candidates: Candidate[]): Walking {
  const destinations = candidates.filter((c): c is Candidate & { to: LngLat } => !!c.to);
  const key = origin ? `${origin.point.join(",")}>${destinations.map((d) => d.key).join(";")}` : "";
  const [state, setState] = useState<WalkingState | null>(null);
  useEffect(() => {
    if (!origin || !destinations.length) return;
    const abort = new AbortController();
    walkingRoutes(origin.point, destinations.map((d) => ({ key: d.key, coordinates: d.to })), abort.signal)
      .then((routes) => setState({ key, walking: { status: "ok", routes } }))
      .catch((e) => { if (!abort.signal.aborted) setState({ key, walking: { status: "unavailable", message: e.message } }); });
    return () => abort.abort();
    // The key lists the origin and every destination, so it captures all inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!origin) return { status: "loading" };
  if (!destinations.length) return { status: "ok", routes: {} };
  return state?.key === key ? state.walking : { status: "loading" };
}

/** GeoJSON points for the map, each with its straight-line distance and, when routed, its walk. */
export function amenityPoints(lists: Record<AmenityCategory, Result | undefined>, origin: NearbyOrigin | null, walking: Walking = { status: "loading" }) {
  return {
    type: "FeatureCollection" as const,
    features: Object.values(lists).flatMap((result) => result?.list?.places ?? []).map((place) => {
      const walk = walking.status === "ok" ? walking.routes[placeKey(place.category, place.name, place.coordinates)] : undefined;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: place.coordinates },
        properties: {
          category: place.category, name: place.name,
          label: AMENITY_LAYERS.find((l) => l.category === place.category)?.label ?? place.category,
          ...(origin ? { metres: Math.round(distanceMetres(origin.point, place.coordinates)) } : {}),
          ...(walk ? { walk_minutes: walk.minutes, walk_metres: walk.metres } : {}),
        },
      };
    }),
  };
}
