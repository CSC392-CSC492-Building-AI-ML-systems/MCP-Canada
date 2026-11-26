import { afterEach, expect, it, vi } from "vitest";
import {
  PROFILE_KEY,
  RECOMMENDED_KEY,
  SAVED_KEY,
  clearProfile,
  parsePlaces,
  profileHref,
  safeReturnTo,
  readSavedRaw,
  readSession,
  writeSaved,
  writeSession,
} from "./state";
import type { ExplorerPlace } from "../explorer/PlacesSidebar";

afterEach(() => vi.unstubAllGlobals());

function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  return { storage, dispatchEvent };
}

const place = (id: string): ExplorerPlace => ({
  id,
  name: `Place ${id}`,
  boundary: "toronto-158",
  year: 2021,
});

it("persists only valid unique saved places and notifies subscribers", () => {
  const { storage, dispatchEvent } = installStorage();
  const places = [place("a"), place("b"), place("a"), ...["c", "d", "e", "f"].map(place)];

  expect(writeSaved(places)).toBe(true);
  expect(storage.setItem).toHaveBeenCalledWith(
    SAVED_KEY,
    JSON.stringify(["a", "b", "c", "d", "e"].map((id) => place(id))),
  );
  expect(parsePlaces(readSavedRaw())).toEqual(["a", "b", "c", "d", "e"].map(place));
  expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "saved-housing-change" }));
});

it("keeps saved places available in memory when browser storage is blocked", () => {
  const { storage } = installStorage();
  storage.setItem.mockImplementation(() => {
    throw new Error("storage blocked");
  });

  expect(writeSaved([place("a")])).toBe(false);
  expect(parsePlaces(readSavedRaw())).toEqual([place("a")]);
});

it("clears the profile and recommendations from session state", () => {
  const { storage, dispatchEvent } = installStorage();
  writeSession(PROFILE_KEY, JSON.stringify({ version: 1 }));
  writeSession(RECOMMENDED_KEY, JSON.stringify([place("a")]));

  clearProfile();

  expect(readSession(PROFILE_KEY)).toBeNull();
  expect(readSession(RECOMMENDED_KEY)).toBeNull();
  expect(storage.removeItem).toHaveBeenCalledWith(PROFILE_KEY);
  expect(storage.removeItem).toHaveBeenCalledWith(RECOMMENDED_KEY);
  expect(dispatchEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "explorer-session-change" }));
});

it("only returns to same-site comparison pages after editing the profile", () => {
  expect(safeReturnTo("/housing/compare/?from=saved&places=a,b")).toBe("/housing/compare/?from=saved&places=a,b");
  expect(safeReturnTo("https://evil.example/housing/compare")).toBeNull();
  expect(safeReturnTo("//evil.example")).toBeNull();
  expect(safeReturnTo("/housing/compare\\..\\x")).toBeNull();
  expect(safeReturnTo(null)).toBeNull();
  expect(profileHref("/housing/compare/?places=a")).toBe("/housing/profile/?returnTo=%2Fhousing%2Fcompare%2F%3Fplaces%3Da");
  expect(profileHref("https://evil.example")).toBe("/housing/profile/");
});
