// Travel times from neighbourhoods to a destination the user picked.
// Walk, bike and drive use the Mapbox Matrix API from the browser:
// https://docs.mapbox.com/api/navigation/matrix/
// Transit uses this app's backend, which plans trips over the published TTC schedule.
import { MAPBOX_TOKEN, type LngLat } from "./mapbox";

export type TravelMode = "Transit" | "Walk" | "Bike" | "Drive";
export const TRAVEL_MODES: TravelMode[] = ["Transit", "Walk", "Bike", "Drive"];
export const isTravelMode = (mode: string): mode is TravelMode => (TRAVEL_MODES as string[]).includes(mode);

export type Origin = { id: string; coordinates: LngLat };
export type TransitLeg = { route: string; name: string; mode: string; board: string; alight: string; depart: string; arrive: string };
export type Commute = {
  minutes: number | null;
  /** Road or path distance (Mapbox modes only). */
  km?: number | null;
  /** Why there is no time, when there isn't. */
  reason?: string;
  /** Transit only. */
  leaveBy?: string; walkOnly?: boolean; legs?: TransitLeg[];
};
export type CommuteSource = { id: string; title: string; publisher: string; url: string };
export type CommuteResult = {
  mode: TravelMode;
  byId: Record<string, Commute>;
  /** How the times were calculated, for captions. */
  method: string;
  source: CommuteSource | null;
  /** Transit: the schedule day and arrival time used. */
  serviceDate?: string; arriveBy?: string;
};

const MATRIX_PROFILE: Record<Exclude<TravelMode, "Transit">, string> = { Walk: "mapbox/walking", Bike: "mapbox/cycling", Drive: "mapbox/driving" };
const MAPBOX_SOURCE: CommuteSource = { id: "mapbox-matrix", title: "Mapbox Matrix API", publisher: "Mapbox, road data © OpenStreetMap contributors", url: "https://docs.mapbox.com/api/navigation/matrix/" };
// Mapbox allows 25 coordinates per Matrix request; one of them is the destination.
const MATRIX_MAX_ORIGINS = 24;

export class CommuteUnavailable extends Error {}

type MatrixResponse = { code: string; message?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };

async function mapboxTimes(mode: Exclude<TravelMode, "Transit">, origins: Origin[], destination: LngLat, signal?: AbortSignal): Promise<CommuteResult> {
  if (!MAPBOX_TOKEN) throw new CommuteUnavailable("Walking, cycling and driving times need a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN).");
  const byId: Record<string, Commute> = {};
  for (let start = 0; start < origins.length; start += MATRIX_MAX_ORIGINS) {
    const batch = origins.slice(start, start + MATRIX_MAX_ORIGINS);
    const coordinates = [...batch.map(o => o.coordinates), destination].map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");
    const params = new URLSearchParams({
      sources: batch.map((_, i) => i).join(";"), destinations: String(batch.length),
      annotations: "duration,distance", access_token: MAPBOX_TOKEN,
    });
    const response = await fetch(`https://api.mapbox.com/directions-matrix/v1/${MATRIX_PROFILE[mode]}/${coordinates}?${params}`, { signal });
    const data: MatrixResponse = await response.json().catch(() => ({ code: "InvalidResponse" }));
    if (!response.ok || data.code !== "Ok") throw new CommuteUnavailable(`Mapbox could not calculate ${mode.toLowerCase()} times (${data.message ?? data.code ?? response.status}).`);
    batch.forEach((origin, i) => {
      const seconds = data.durations?.[i]?.[0] ?? null;
      const metres = data.distances?.[i]?.[0] ?? null;
      byId[origin.id] = seconds === null
        ? { minutes: null, reason: "No route found from this neighbourhood." }
        : { minutes: Math.max(1, Math.round(seconds / 60)), km: metres === null ? null : Math.round(metres / 100) / 10 };
    });
  }
  const detail = { Walk: "Walking route", Bike: "Cycling route", Drive: "Driving route at typical speeds, without live traffic" }[mode];
  return { mode, byId, source: MAPBOX_SOURCE, method: `${detail} from Mapbox, from a central point in each neighbourhood.` };
}

type TransitResponse = {
  status: string; error?: string; service_date: string; arrive_by: string; method: string;
  source: CommuteSource & { version: string };
  results: { id: string; minutes: number | null; reason?: string; leave_by?: string; walk_only?: boolean; legs?: TransitLeg[] }[];
};

async function transitTimes(origins: Origin[], destination: LngLat, signal?: AbortSignal): Promise<CommuteResult> {
  // POST keeps the destination out of URLs and server logs. The backend stores nothing.
  const response = await fetch("/api/transit/commute/", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({
      destination: { lng: destination[0], lat: destination[1] }, arrive_by: "09:00",
      origins: origins.map(o => ({ id: o.id, lng: o.coordinates[0], lat: o.coordinates[1] })),
    }),
  });
  const data: TransitResponse = await response.json().catch(() => ({ status: "error", error: "Transit routing did not respond." }) as TransitResponse);
  if (!response.ok) throw new CommuteUnavailable(data.error || "Transit routing is unavailable.");
  const byId: Record<string, Commute> = {};
  for (const r of data.results) byId[r.id] = r.minutes === null
    ? { minutes: null, reason: r.reason }
    : { minutes: r.minutes, leaveBy: r.leave_by, walkOnly: r.walk_only, legs: r.legs ?? [] };
  return {
    mode: "Transit", byId, serviceDate: data.service_date, arriveBy: data.arrive_by,
    source: data.source, method: `${data.method} Times run from a central point in each neighbourhood.`,
  };
}

/** Travel time from each origin to the destination by the given mode. */
export function commuteTimes(mode: TravelMode, origins: Origin[], destination: LngLat, signal?: AbortSignal): Promise<CommuteResult> {
  return mode === "Transit" ? transitTimes(origins, destination, signal) : mapboxTimes(mode, origins, destination, signal);
}

/** 100 at or under half your longest acceptable trip, 50 at the limit, 0 at 1.5 times it or more. */
export function commuteScore(minutes: number | null | undefined, limit: number): number | null {
  if (minutes == null || !(limit > 0)) return null;
  return Math.round(Math.max(0, Math.min(100, (1.5 - minutes / limit) * 100)));
}

/** "8:21 AM" from "08:21". */
export function clockLabel(hhmm: string | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${(h % 12) || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Short route list, e.g. "54 → Line 2 → Line 1". */
export function routeSummary(legs: TransitLeg[] | undefined): string {
  return (legs ?? []).map(l => l.mode === "subway" ? `Line ${l.route}` : l.route).join(" → ");
}
