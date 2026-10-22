// Shared Mapbox config.

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export type LngLat = [number, number];

export const TORONTO_CENTER: LngLat = [-79.3832, 43.6532];
// [minLng, minLat, maxLng, maxLat] around the City of Toronto boundary.
export const TORONTO_BBOX: [number, number, number, number] = [-79.6393, 43.581, -79.1152, 43.8555];
