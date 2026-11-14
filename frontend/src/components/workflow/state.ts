import type { ExplorerPlace } from "../explorer/PlacesSidebar";
export type SearchProfile = {
  version: 1; income: string; rent: string; bedrooms: string; mode: string;
  work: string; school: string; trip: number; priorities: number[]; weights: number[];
  interests: string[]; notes: string;
};
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
    if (!p || p.version !== 1 || !["income", "rent", "bedrooms", "mode", "work", "school", "notes"].every(k => typeof p[k] === "string")) return null;
    if (!Number.isFinite(Number(p.rent)) || Number(p.rent) <= 0 || (p.income.trim() && (!Number.isFinite(Number(p.income)) || Number(p.income) <= 0))) return null;
    if (!Number.isFinite(p.trip) || p.trip < 0 || p.trip > 120 || !Array.isArray(p.priorities) || p.priorities.length > 3 || !p.priorities.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) < 8)) return null;
    if (!Array.isArray(p.weights) || p.weights.length !== 6 || !p.weights.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 5) || !Array.isArray(p.interests) || !p.interests.every((s: unknown) => typeof s === "string")) return null;
    return p;
  } catch { return null; }
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
