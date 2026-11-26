import { afterEach, describe, expect, it, vi } from "vitest";
import { readShowBoundaries, SHOW_BOUNDARIES_KEY, writeShowBoundaries } from "./mapPreferences";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, store };
}
afterEach(() => vi.unstubAllGlobals());

describe("boundary outline preference", () => {
  it("shows boundaries by default", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    vi.stubGlobal("localStorage", fakeStorage());
    expect(fresh.readShowBoundaries()).toBe(true);
  });
  it("remembers that the viewer turned them off and back on", () => {
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    writeShowBoundaries(false);
    expect(storage.store.get(SHOW_BOUNDARIES_KEY)).toBe("false");
    expect(readShowBoundaries()).toBe(false);
    writeShowBoundaries(true);
    expect(readShowBoundaries()).toBe(true);
  });
  it("still toggles for this visit when storage is blocked", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(fresh.readShowBoundaries()).toBe(true);
    expect(() => fresh.writeShowBoundaries(false)).not.toThrow();
    expect(fresh.readShowBoundaries()).toBe(false);
  });
});

describe("population shading preference", () => {
  it("is on by default and independent of the boundary outlines", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    expect(fresh.readShowPopulation()).toBe(true);
    fresh.writeShowPopulation(false);
    expect(storage.store.get(fresh.SHOW_POPULATION_KEY)).toBe("false");
    expect(fresh.readShowPopulation()).toBe(false);
    expect(fresh.readShowBoundaries()).toBe(true);
  });
});

describe("amenity layer preference", () => {
  it("starts with no layers and remembers the chosen ones", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    vi.stubGlobal("localStorage", fakeStorage());
    expect(fresh.readAmenityLayers()).toBe("");
    fresh.writeAmenityLayers(["school", "grocery", "school"]);
    expect(fresh.readAmenityLayers()).toBe("grocery,school");
  });
});

describe("land use preference", () => {
  it("is off by default and remembered when turned on", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    vi.stubGlobal("localStorage", fakeStorage());
    expect(fresh.readShowLandUse()).toBe(false);
    fresh.writeShowLandUse(true);
    expect(fresh.readShowLandUse()).toBe(true);
    expect(fresh.readShowPopulation()).toBe(true);
  });
});

describe("commute shading preference", () => {
  it("is off by default and remembered", async () => {
    vi.resetModules();
    const fresh = await import("./mapPreferences");
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    expect(fresh.readShowCommute()).toBe(false);
    fresh.writeShowCommute(true);
    expect(storage.store.get(fresh.SHOW_COMMUTE_KEY)).toBe("true");
    expect(fresh.readShowCommute()).toBe(true);
  });
});
