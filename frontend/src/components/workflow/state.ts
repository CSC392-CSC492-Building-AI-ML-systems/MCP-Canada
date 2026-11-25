import type { ExplorerPlace } from "../explorer/PlacesSidebar";
export type SearchProfile = {
  version: 1; income: string; rent: string; mode: string;
  work: string; school: string; trip: number; priorities: number[]; weights: number[];
  interests: string[]; notes: string; bedrooms?: string;
  /** Coordinates of the chosen work and school addresses; absent or null when none was picked. */
  workPoint?: GeoPoint | null; schoolPoint?: GeoPoint | null;
};
export type GeoPoint = { lng: number; lat: number };
/** Destinations are accepted in the Greater Toronto Area only. */
export function isGeoPoint(value: unknown): value is GeoPoint {
  const p = value as GeoPoint | null;
  return !!p && typeof p === "object" && Number.isFinite(p.lng) && Number.isFinite(p.lat)
    && p.lat >= 43.4 && p.lat <= 44.05 && p.lng >= -79.9 && p.lng <= -78.9;
}
/** Lifestyle priorities; a profile stores up to three of these by index. */
export const LIFESTYLE_OPTIONS = [
  "Family-friendly", "Transit access", "Parks & green space", "Restaurants & nightlife",
  "Quiet & residential", "Cultural community", "Walkable errands", "Good school access",
] as const;
export const PROFILE_KEY = "mcp-canada-profile-v1";
export const SAVED_KEY = "mcp-canada-saved-housing";
export const RECOMMENDED_KEY = "mcp-canada-recommended-v1";
export function parseProfile(raw: string | null): SearchProfile | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || p.version !== 1 || !["income", "rent", "mode", "work", "school", "notes"].every(k => typeof p[k] === "string")) return null;
    if (p.bedrooms !== undefined && typeof p.bedrooms !== "string") return null;
    // Rent and income may be blank (not provided yet); scoring then leaves affordability out instead of counting it as 0.
    if (!blankOrPositive(p.rent) || !blankOrPositive(p.income)) return null;
    if (!validTrip(p.trip) || !validPriorities(p.priorities)) return null;
    if (!validWeights(p.weights) || !Array.isArray(p.interests) || !p.interests.every((s: unknown) => typeof s === "string")) return null;
    if ([p.workPoint, p.schoolPoint].some(point => point != null && !isGeoPoint(point))) return null;
    return p;
  } catch { return null; }
}
const blankOrPositive = (value: string) => !value.trim() || (Number.isFinite(Number(value)) && Number(value) > 0);
const validTrip = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 120;
const validPriorities = (list: unknown) => Array.isArray(list) && list.length <= 3 && list.every(n => Number.isInteger(n) && n >= 0 && n < 8);
const validWeights = (list: unknown) => Array.isArray(list) && list.length === 6 && list.every(n => Number.isInteger(n) && n >= 0 && n <= 5);

/** Profile fields whose current input could not be saved, so the last saved value was kept instead. */
export type HeldField = "rent" | "income" | "trip" | "priorities" | "weights" | "work" | "school";
/** What autosave stores for a form draft: every valid field as entered, and for each invalid or
 * half-finished field the last saved value (or an empty default), so one bad input never blocks the
 * others or overwrites a good saved value. Blank optional fields are saved as blank. */
export function profileForSave(draft: SearchProfile, saved: SearchProfile | null): { profile: SearchProfile; held: HeldField[] } {
  const held: HeldField[] = [];
  function keep<T>(field: HeldField, value: T, ok: boolean, previous: T | undefined, fallback: T): T {
    if (ok) return value;
    held.push(field);
    return previous ?? fallback;
  }
  // Blank rent is only kept as blank when nothing was saved before: clearing the box to retype it is temporary.
  const rentBlank = !draft.rent.trim();
  const savedRent = saved?.rent.trim() ? saved.rent : undefined;
  const rent = rentBlank && !savedRent ? draft.rent : keep("rent", draft.rent, !rentBlank && blankOrPositive(draft.rent), savedRent, "");
  // An address counts once a suggestion with coordinates is picked, or when the box is cleared. While a
  // new address is being typed, the saved address and its coordinates stay in use.
  function destination(field: "work" | "school", text: string, point: GeoPoint | null | undefined, savedText = "", savedPoint?: GeoPoint | null) {
    const chosen = isGeoPoint(point) ? point : null;
    if (!text.trim() || chosen || !isGeoPoint(savedPoint)) return { text, point: chosen };
    held.push(field);
    return { text: savedText, point: savedPoint };
  }
  const work = destination("work", draft.work, draft.workPoint, saved?.work, saved?.workPoint);
  const school = destination("school", draft.school, draft.schoolPoint, saved?.school, saved?.schoolPoint);
  const profile: SearchProfile = {
    version: 1,
    income: keep("income", draft.income, blankOrPositive(draft.income), saved?.income, ""),
    rent,
    mode: draft.mode,
    work: work.text,
    school: school.text,
    trip: keep("trip", draft.trip, validTrip(draft.trip), saved?.trip, 30),
    priorities: keep("priorities", draft.priorities, validPriorities(draft.priorities), saved?.priorities, []),
    weights: keep("weights", draft.weights, validWeights(draft.weights), saved?.weights, [3, 3, 3, 3, 3, 3]),
    interests: draft.interests.filter(s => typeof s === "string"),
    notes: draft.notes,
    workPoint: work.point,
    schoolPoint: school.point,
  };
  return { profile, held };
}
export function parsePlaces(raw: string | null): ExplorerPlace[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((p): p is ExplorerPlace => {
      if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !Number.isInteger(p.year) || !["toronto-140", "toronto-158"].includes(p.boundary) || seen.has(p.id)) return false;
      seen.add(p.id); return true;
    }).slice(0, 5);
  } catch { return []; }
}
export function readProfile() {
  try { return parseProfile(readSession(PROFILE_KEY)); } catch { return null; }
}
export function comparisonHref(places: ExplorerPlace[], from: "saved" | "recommended" = "saved") {
  const params = new URLSearchParams({ from, places: [...new Set(places.map(p => p.id))].slice(0, 5).join(",") });
  return `/housing/compare/?${params}`;
}
/** Only same-site comparison pages are accepted as a place to return to after editing the profile. */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/housing/compare") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
/** Link to the profile page that remembers which comparison to return to. */
export function profileHref(returnTo?: string | null) {
  const safe = safeReturnTo(returnTo);
  return safe ? `/housing/profile/?${new URLSearchParams({ returnTo: safe })}` : "/housing/profile/";
}
export function explorerHref(selection: { geographyId: string; year: number } | null, across = false) {
  const params = new URLSearchParams();
  if (selection) { params.set("neighbourhood", selection.geographyId); params.set("year", String(selection.year)); }
  return `/housing/${across ? "across-time/" : ""}${params.size ? `?${params}` : ""}`;
}

const sessionMemory = new Map<string, string | null>();
export function readSession(key: string): string | null {
  if (sessionMemory.has(key)) return sessionMemory.get(key) ?? null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function writeSession(key: string, value: string) {
  sessionMemory.set(key, value);
  try { sessionStorage.setItem(key, value); } catch { /* Memory retains the flow for this tab. */ }
  window.dispatchEvent(new Event("explorer-session-change"));
}
export function clearProfile() {
  sessionMemory.set(PROFILE_KEY, null);
  sessionMemory.set(RECOMMENDED_KEY, null);
  try { sessionStorage.removeItem(PROFILE_KEY); sessionStorage.removeItem(RECOMMENDED_KEY); } catch { /* Storage may be blocked. */ }
  window.dispatchEvent(new Event("explorer-session-change"));
}
export function subscribeSession(callback: () => void) {
  window.addEventListener("explorer-session-change", callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener("explorer-session-change", callback); window.removeEventListener("storage", callback); };
}

let savedMemory: string | null = null;
let savedVolatile = false;
export function readSavedRaw(): string {
  if (savedVolatile) return savedMemory ?? "[]";
  try { return localStorage.getItem(SAVED_KEY) ?? savedMemory ?? "[]"; } catch { return savedMemory ?? "[]"; }
}
export function subscribeSaved(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("saved-housing-change", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("saved-housing-change", callback); };
}
export function writeSaved(places: ExplorerPlace[]): boolean {
  const value = JSON.stringify(parsePlaces(JSON.stringify(places)));
  savedMemory = value;
  let persisted = true;
  try { localStorage.setItem(SAVED_KEY, value); } catch { persisted = false; }
  savedVolatile = !persisted;
  window.dispatchEvent(new Event("saved-housing-change"));
  return persisted;
}
