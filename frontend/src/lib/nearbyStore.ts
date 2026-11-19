// Nearby places for the neighbourhood on the map, shared with the details panel so
// both show the same numbers. The map publishes; the panel reads.
import type { AmenityCategory, NearbySummary } from "./amenities";

export type NearbySnapshot = {
  geographyId: string;
  /** e.g. "the centre of Annex" or "your searched address" */
  originLabel: string;
  summaries: Record<AmenityCategory | "park", NearbySummary>;
  /** Newest snapshot date among the loaded lists. */
  asOf: string | null;
  /** True when walking times follow streets (Mapbox); false when they are straight-line estimates. */
  routed: boolean;
} | null;

let current: NearbySnapshot = null;
const listeners = new Set<() => void>();

export function publishNearby(snapshot: NearbySnapshot) {
  current = snapshot;
  for (const listener of listeners) listener();
}
export const readNearby = () => current;
export function subscribeNearby(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
