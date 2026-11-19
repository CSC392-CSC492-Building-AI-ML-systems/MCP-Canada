/** Per-viewer map display choices, remembered in this browser only. Storage can be
 * blocked (private windows, previews), so a choice then lasts for this visit. */
export const SHOW_BOUNDARIES_KEY = "mcp-canada-show-boundaries";
export const SHOW_POPULATION_KEY = "mcp-canada-show-population";
const CHANGE_EVENT = "map-preferences-change";
const memory = new Map<string, boolean>();

/** On unless this viewer turned it off. */
function read(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? memory.get(key) ?? true : stored !== "false";
  } catch { return memory.get(key) ?? true; }
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

export function subscribeMapPreferences(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", callback); };
}
