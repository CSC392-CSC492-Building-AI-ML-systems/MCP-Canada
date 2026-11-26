"use client";
/** Commute and school travel times for neighbourhoods, from the destinations in the user's profile. */
import { useEffect, useState } from "react";
import { loadBoundaries, representativePoint, type Boundaries } from "@/lib/boundaries";
import { commuteTimes, isTravelMode, type CommuteResult, type Origin } from "@/lib/routing";
import type { GeoPoint, SearchProfile } from "./state";

export type Trip = "work" | "school";
export type TripState =
  | { status: "no-destination" } | { status: "loading" }
  | { status: "ready"; result: CommuteResult } | { status: "error"; message: string };
export type CommuteState = Record<Trip, TripState>;
export type CommutePlace = { id: string; boundarySetId: string };

const boundaryCache = new Map<string, Promise<Boundaries>>();
function boundariesFor(setId: string) {
  let pending = boundaryCache.get(setId);
  if (!pending) {
    pending = loadBoundaries(setId);
    pending.catch(() => boundaryCache.delete(setId));
    boundaryCache.set(setId, pending);
  }
  return pending;
}

/** A central point inside each neighbourhood, used as the start of every trip. */
export async function neighbourhoodOrigins(places: CommutePlace[]): Promise<Origin[]> {
  const sets = await Promise.all([...new Set(places.map(p => p.boundarySetId))].map(async id => [id, await boundariesFor(id)] as const));
  const byId = new Map(sets.flatMap(([, b]) => b.features.map(f => [f.properties.geography_id, f] as const)));
  return places.flatMap(p => { const f = byId.get(p.id); return f ? [{ id: p.id, coordinates: representativePoint(f.geometry) }] : []; });
}

const pointKey = (p: GeoPoint | null | undefined) => p ? `${p.lng.toFixed(5)},${p.lat.toFixed(5)}` : "";

export function useCommutes(places: CommutePlace[], preferences: SearchProfile | null): CommuteState {
  const mode = preferences && isTravelMode(preferences.mode) ? preferences.mode : "Transit";
  const destinations: Record<Trip, GeoPoint | null> = { work: preferences?.workPoint ?? null, school: preferences?.schoolPoint ?? null };
  const key = `${places.map(p => `${p.boundarySetId}/${p.id}`).join("|")}:${mode}:${pointKey(destinations.work)}:${pointKey(destinations.school)}`;
  const [state, setState] = useState<{ key: string; value: CommuteState } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const trips = (["work", "school"] as const).filter(t => destinations[t]);
    if (!places.length || !trips.length) return;
    const update = (trip: Trip, value: TripState) => setState(s => {
      const base: CommuteState = s?.key === key ? s.value : { work: { status: "no-destination" }, school: { status: "no-destination" } };
      return { key, value: { ...base, [trip]: value } };
    });
    neighbourhoodOrigins(places).then(origins => Promise.all(trips.map(trip => {
      const { lng, lat } = destinations[trip]!;
      return commuteTimes(mode, origins, [lng, lat], abort.signal)
        .then(result => { if (!abort.signal.aborted) update(trip, { status: "ready", result }); })
        .catch((e: Error) => { if (!abort.signal.aborted) update(trip, { status: "error", message: e.message || "Travel times are unavailable." }); });
    }))).catch((e: Error) => {
      if (!abort.signal.aborted) for (const trip of trips) update(trip, { status: "error", message: e.message || "Could not load neighbourhood boundaries." });
    });
    return () => abort.abort();
    // `key` captures every input that changes the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state?.key === key ? state.value : null;
  const pick = (trip: Trip): TripState => {
    if (!destinations[trip] || !places.length) return { status: "no-destination" };
    const value = current?.[trip];
    return value && value.status !== "no-destination" ? value : { status: "loading" };
  };
  return { work: pick("work"), school: pick("school") };
}

/** Minutes for one place, or null when unavailable. */
export function tripMinutes(state: TripState, id: string): number | null {
  return state.status === "ready" ? state.result.byId[id]?.minutes ?? null : null;
}
