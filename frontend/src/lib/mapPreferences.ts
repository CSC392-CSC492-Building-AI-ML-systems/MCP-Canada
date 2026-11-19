/** Per-viewer map display choices, remembered in this browser only. Storage can be
 * blocked (private windows, previews), so the choice then lasts for this visit. */
export const SHOW_BOUNDARIES_KEY = "mcp-canada-show-boundaries";
const CHANGE_EVENT = "map-preferences-change";
let memory: boolean | null = null;

/** Neighbourhood outlines are shown unless this viewer turned them off. */
export function readShowBoundaries(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_BOUNDARIES_KEY);
    return stored === null ? memory ?? true : stored !== "false";
  } catch { return memory ?? true; }
}

export function writeShowBoundaries(show: boolean) {
  memory = show;
  try { localStorage.setItem(SHOW_BOUNDARIES_KEY, String(show)); } catch { /* Kept in memory for this visit. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeMapPreferences(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", callback); };
}
