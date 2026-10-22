// Shared Mapbox config and Search Box API helpers.
// Docs: https://docs.mapbox.com/api/search/search-box/

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export type LngLat = [number, number];

export const TORONTO_CENTER: LngLat = [-79.3832, 43.6532];
// [minLng, minLat, maxLng, maxLat] around the City of Toronto boundary.
export const TORONTO_BBOX: [number, number, number, number] = [-79.6393, 43.581, -79.1152, 43.8555];

const SEARCH_URL = "https://api.mapbox.com/search/searchbox/v1";

export type Suggestion = {
  mapboxId: string;
  name: string;
  detail: string;
  featureType: string;
};

export type Place = {
  name: string;
  address: string;
  coordinates: LngLat;
};

type SuggestResponse = {
  suggestions: {
    mapbox_id: string;
    name: string;
    full_address?: string;
    place_formatted?: string;
    feature_type: string;
  }[];
};

type RetrieveResponse = {
  features: {
    geometry: { coordinates: LngLat };
    properties: { name: string; full_address?: string; place_formatted?: string };
  }[];
};

// Suggest + retrieve calls that share a session token are billed as one search session.
export function newSessionToken(): string {
  return crypto.randomUUID();
}

export async function suggestPlaces(query: string, sessionToken: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    q: query,
    access_token: MAPBOX_TOKEN,
    session_token: sessionToken,
    language: "en",
    country: "ca",
    limit: "6",
    proximity: TORONTO_CENTER.join(","),
    bbox: TORONTO_BBOX.join(","),
    types: "address,street,poi,neighborhood,postcode",
  });
  const response = await fetch(`${SEARCH_URL}/suggest?${params}`, { signal });
  if (!response.ok) throw new Error(`Mapbox suggest failed (${response.status})`);
  const data: SuggestResponse = await response.json();
  return data.suggestions.map((s) => ({
    mapboxId: s.mapbox_id,
    name: s.name,
    detail: s.full_address ?? s.place_formatted ?? "",
    featureType: s.feature_type,
  }));
}

export async function retrievePlace(mapboxId: string, sessionToken: string): Promise<Place> {
  const params = new URLSearchParams({ access_token: MAPBOX_TOKEN, session_token: sessionToken });
  const response = await fetch(`${SEARCH_URL}/retrieve/${encodeURIComponent(mapboxId)}?${params}`);
  if (!response.ok) throw new Error(`Mapbox retrieve failed (${response.status})`);
  const data: RetrieveResponse = await response.json();
  const feature = data.features[0];
  if (!feature) throw new Error("No location found");
  return {
    name: feature.properties.name,
    address: feature.properties.full_address ?? feature.properties.place_formatted ?? "",
    coordinates: feature.geometry.coordinates,
  };
}
