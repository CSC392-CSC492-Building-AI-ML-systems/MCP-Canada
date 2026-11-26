/** Per-viewer map display choices, remembered in this browser only. Storage can be
 * blocked (private windows, previews), so a choice then lasts for this visit. */
export const SHOW_BOUNDARIES_KEY = "mcp-canada-show-boundaries";
export const SHOW_POPULATION_KEY = "mcp-canada-show-population";
export const AMENITY_LAYERS_KEY = "mcp-canada-amenity-layers";
export const SHOW_LAND_USE_KEY = "mcp-canada-show-land-use";
export const SHOW_COMMUTE_KEY = "mcp-canada-show-commute";
const CHANGE_EVENT = "map-preferences-change";
const memory = new Map<string, boolean>();
const textMemory = new Map<string, string>();

/** The viewer's choice, or `fallback` when they have not made one. */
function read(key: string, fallback = true): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? memory.get(key) ?? fallback : stored === "true";
  } catch { return memory.get(key) ?? fallback; }
}

function write(key: string, show: boolean) {
  memory.set(key, show);
  try { localStorage.setItem(key, String(show)); } catch { /* Kept in memory for this visit. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Outlines of every neighbourhood. */
export const readShowBoundaries = () => read(SHOW_BOUNDARIES_KEY);
export const writeShowBoundaries = (show: boolean) => write(SHOW_BOUNDARIES_KEY, show);
/** Population shading and its legend. */
export const readShowPopulation = () => read(SHOW_POPULATION_KEY);
export const writeShowPopulation = (show: boolean) => write(SHOW_POPULATION_KEY, show);
/** Zoning (land use) colours. Off by default. */
export const readShowLandUse = () => read(SHOW_LAND_USE_KEY, false);
export const writeShowLandUse = (show: boolean) => write(SHOW_LAND_USE_KEY, show);
/** Commute time shading from the profile's work or school address. Off by default. */
export const readShowCommute = () => read(SHOW_COMMUTE_KEY, false);
export const writeShowCommute = (show: boolean) => write(SHOW_COMMUTE_KEY, show);

/** Amenity layers this viewer turned on, as a comma-separated list (a stable snapshot
 * for useSyncExternalStore). Off by default so the map is not cluttered. */
export function readAmenityLayers(): string {
  try { return localStorage.getItem(AMENITY_LAYERS_KEY) ?? textMemory.get(AMENITY_LAYERS_KEY) ?? ""; }
  catch { return textMemory.get(AMENITY_LAYERS_KEY) ?? ""; }
}
export function writeAmenityLayers(categories: string[]) {
  const value = [...new Set(categories)].sort().join(",");
  textMemory.set(AMENITY_LAYERS_KEY, value);
  try { localStorage.setItem(AMENITY_LAYERS_KEY, value); } catch { /* Kept in memory for this visit. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeMapPreferences(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", callback); };
}
