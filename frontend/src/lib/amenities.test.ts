import { afterEach, describe, expect, it, vi } from "vitest";
import { displayName, distanceMetres, distanceScore, expandedBbox, formatDistance, interiorPoint, loadAmenities, loadNearbyParks, nearest, parkCandidates, placeKey,
  summarizeNearby, summarizeParks, walkMinutes, type Amenity, type Walking } from "./amenities";
import type { BoundaryGeometry } from "./boundaries";
import type { LngLat } from "./mapbox";

afterEach(() => vi.unstubAllGlobals());

const square = (west: number, south: number, size: number): BoundaryGeometry => ({
  type: "Polygon", coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]],
});
const place = (name: string, coordinates: LngLat): Amenity => ({ category: "grocery", name, coordinates, validOn: "2026-10-27", kind: null });

describe("distance", () => {
  it("measures straight-line metres", () => {
    // 0.01° of latitude is about 1.11 km anywhere.
    expect(distanceMetres([-79.4, 43.65], [-79.4, 43.66])).toBeCloseTo(1112, -1);
    expect(distanceMetres([-79.4, 43.65], [-79.4, 43.65])).toBe(0);
  });
  it("estimates walking time at 4.8 km/h along a route 1.3 times the straight line", () => {
    expect(walkMinutes(400)).toBe(7);   // 520 m of street at 80 m/min
    expect(walkMinutes(0)).toBe(1);
  });
  it("formats short and long distances", () => {
    expect(formatDistance(347)).toBe("350 m");
    expect(formatDistance(1240)).toBe("1.2 km");
  });
});

describe("distanceScore", () => {
  it("scores a closer amenity higher: 400 m beats 1.2 km, and beyond the limit scores 0", () => {
    expect(distanceScore(400, 1500)!).toBeGreaterThan(distanceScore(1200, 1500)!);
    expect(distanceScore(1200)).toBe(0);
    expect(distanceScore(0)).toBe(100);
  });
  it("never rewards being farther away", () => {
    const scores = [0, 100, 250, 500, 999, 1000, 5000].map((m) => distanceScore(m)!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it("is unavailable, not zero, without a distance", () => {
    expect(distanceScore(null)).toBeNull();
    expect(distanceScore(Number.NaN)).toBeNull();
  });
});

describe("areas", () => {
  it("widens the bounding box by the nearby distance", () => {
    const [west, south, east, north] = expandedBbox(square(-79.4, 43.65, 0.01), 1000);
    expect(south).toBeCloseTo(43.65 - 0.009, 3);
    expect(north).toBeCloseTo(43.66 + 0.009, 3);
    expect(east - west).toBeGreaterThan(0.01 + 2 * 0.0123);
  });
  it("measures from the middle of a simple area", () => {
    expect(interiorPoint(square(0, 0, 2), () => true)).toEqual([1, 1]);
  });
  it("measures from a point inside an area whose middle lies outside it", () => {
    const inside = ([x, y]: LngLat) => x <= 0.5 && y >= 0 && y <= 2 && x >= 0;   // a thin strip on the left
    const point = interiorPoint(square(0, 0, 2), ([x, y]) => inside([x, y]));
    expect(inside(point)).toBe(true);
  });
  it("lists the nearest places first", () => {
    const origin: LngLat = [-79.4, 43.65];
    const list = nearest([place("Far", [-79.4, 43.66]), place("Near", [-79.4, 43.651]), place("Mid", [-79.4, 43.655])], origin, 2);
    expect(list.map((p) => p.name)).toEqual(["Near", "Mid"]);
    expect(list[0].metres).toBeLessThan(list[1].metres);
  });
});

describe("loadAmenities", () => {
  function serve(body: unknown, type = "application/json", status = 200) {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(new URL(input, "http://localhost"));
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
    });
    return calls;
  }
  it("asks for one category inside the area and keeps the source", async () => {
    const calls = serve({ places: [{ name: "Shop", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: "supermarket" }],
      sources: [{ title: "Grocery-related shops", publisher: "OpenStreetMap contributors" }], category_loaded: true });
    const list = await loadAmenities("grocery", [-79.5, 43.6, -79.2, 43.8]);
    expect(calls[0].searchParams.get("category")).toBe("grocery");
    expect(calls[0].searchParams.get("bbox")).toBe("-79.500000,43.600000,-79.200000,43.800000");
    expect(list).toMatchObject({ loaded: true, places: [{ name: "Shop", coordinates: [-79.3, 43.7] }], source: { publisher: "OpenStreetMap contributors" } });
  });
  it("counts only supermarkets and greengrocers as groceries, like the import, and tidies capitalised names", async () => {
    serve({ places: [
      { name: "NO FRILLS", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: "supermarket" },
      { name: "Corner Fruit", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: "greengrocer" },
      { name: "Circle K", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: "convenience" },
      { name: "Unknown shop", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: null },
    ], sources: [], category_loaded: true });
    expect((await loadAmenities("grocery", [0, 0, 1, 1])).places.map((p) => p.name)).toEqual(["No Frills", "Corner Fruit"]);
    serve({ places: [{ name: "HUMBERSIDE MONTESSORI SCHOOL", latitude: 43.7, longitude: -79.3, valid_on: "2026-10-27", kind: null }], sources: [], category_loaded: true });
    expect((await loadAmenities("school", [0, 0, 1, 1])).places.map((p) => p.name)).toEqual(["Humberside Montessori School"]);
  });
  it("tells a list that was never imported apart from an area with none", async () => {
    serve({ places: [], sources: [], category_loaded: false });
    expect((await loadAmenities("grocery", [0, 0, 1, 1])).loaded).toBe(false);
    serve({ places: [], sources: [], category_loaded: true });
    expect((await loadAmenities("grocery", [0, 0, 1, 1])).loaded).toBe(true);
  });
  it("explains an HTML error page instead of failing to parse it", async () => {
    serve("<!DOCTYPE html><title>Page not found</title>", "text/html", 404);
    await expect(loadAmenities("school", [0, 0, 1, 1])).rejects.toThrow(/error page/);
  });
});

describe("walking summaries", () => {
  const origin: LngLat = [-79.4, 43.65];
  const list = (loaded: boolean, places: Amenity[]) => ({ list: { category: "grocery" as const, loaded, places, source: null } });
  const far = place("Far", [-79.4, 43.665]), near = place("Near", [-79.4, 43.651]), mid = place("Mid", [-79.4, 43.655]);
  const key = (p: Amenity) => placeKey("grocery", p.name, p.coordinates);

  it("picks the quickest street walk, which need not be the straight-line nearest", () => {
    // "Near" is closest in a straight line but sits across a barrier: an 18-minute walk.
    const walking: Walking = { status: "ok", routes: { [key(near)]: { minutes: 18, metres: 1400 }, [key(mid)]: { minutes: 9, metres: 700 }, [key(far)]: { minutes: 25, metres: 2000 } } };
    const s = summarizeNearby(list(true, [far, near, mid]), origin, walking);
    expect(s).toMatchObject({ state: "ok", within: 2, nearest: { name: "Mid", minutes: 9, metres: 700, estimated: false } });
    expect(s.state === "ok" && s.ranked.map((p) => p.name)).toEqual(["Mid", "Near", "Far"]);
  });
  it("puts a place with no walking route last, as an estimate", () => {
    const walking: Walking = { status: "ok", routes: { [key(near)]: null, [key(mid)]: { minutes: 9, metres: 700 } } };
    const s = summarizeNearby(list(true, [near, mid]), origin, walking);
    expect(s.state === "ok" && s.ranked.map((p) => [p.name, p.estimated])).toEqual([["Mid", false], ["Near", true]]);
  });
  it("falls back to labelled straight-line estimates when routes are unavailable", () => {
    const s = summarizeNearby(list(true, [near]), origin, { status: "unavailable", message: "no token" });
    expect(s).toMatchObject({ state: "ok", nearest: { name: "Near", estimated: true, minutes: 2 } });
  });
  it("waits for routes, and keeps loading, failure, never-imported and none-nearby apart", () => {
    expect(summarizeNearby(list(true, [near]), origin, { status: "loading" })).toEqual({ state: "loading" });
    expect(summarizeNearby(undefined, origin, { status: "ok", routes: {} })).toEqual({ state: "loading" });
    expect(summarizeNearby({ error: "down" }, origin, { status: "ok", routes: {} })).toEqual({ state: "error", message: "down" });
    expect(summarizeNearby(list(false, []), origin, { status: "ok", routes: {} })).toEqual({ state: "not_loaded" });
    expect(summarizeNearby(list(true, []), origin, { status: "ok", routes: {} })).toEqual({ state: "ok", within: 0, nearest: null, ranked: [] });
  });
});

describe("parks", () => {
  it("title-cases names the source stores in capitals and leaves others alone", () => {
    expect(displayName("HUMBER ARBORETUM")).toBe("Humber Arboretum");
    expect(displayName("ST. JAMES-TOWN PARK (EAST)")).toBe("St. James-Town Park (East)");
    expect(displayName("Trinity Bellwoods Park")).toBe("Trinity Bellwoods Park");
  });
  it("routes to a park's nearest edge, and needs no walk from inside one", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ category_loaded: true, within_1km: 2,
      nearest: [{ name: "HIGH PARK", metres: 0, point: [-79.46, 43.646] }, { name: "RENNIE PARK", metres: 712, point: [-79.47, 43.65] }],
      features: { type: "FeatureCollection", features: [] }, as_of: "2026-11-14", source: { title: "Green Spaces", publisher: "City of Toronto" } }),
      { headers: { "content-type": "application/json" } }));
    const parks = await loadNearbyParks([-79.4636, 43.6465], [-79.5, 43.6, -79.4, 43.7]);
    const candidates = parkCandidates(parks);
    expect(candidates.map((c) => [c.name, c.to])).toEqual([["High Park", null], ["Rennie Park", [-79.47, 43.65]]]);
    const s = summarizeParks({ parks }, { status: "ok", routes: { [candidates[1].key]: { minutes: 11, metres: 830 } } });
    expect(s.state === "ok" && s.ranked.map((p) => [p.name, p.minutes, p.metres])).toEqual([["High Park", 0, 0], ["Rennie Park", 11, 830]]);
    // Inside a park needs no route, so it is not held back waiting for one.
    expect(summarizeParks({ parks: { ...parks, nearest: [parks.nearest[0]] } }, { status: "loading" })).toMatchObject({ state: "ok" });
    expect(summarizeParks({ parks: { ...parks, loaded: false, within: null } }, { status: "loading" })).toEqual({ state: "not_loaded" });
    // An older backend without edge points: the park is a labelled estimate, never "inside".
    const noPoint = { ...parks, nearest: [{ name: "Rennie Park", metres: 712, point: null }] };
    expect(summarizeParks({ parks: noPoint }, { status: "ok", routes: {} })).toMatchObject({ nearest: { name: "Rennie Park", estimated: true, metres: 712 } });
  });
});

describe("placeText", () => {
  it("reads a street walk, a labelled estimate and being inside a park", async () => {
    const { placeText } = await import("./amenities");
    expect(placeText({ name: "A", straightMetres: 360, minutes: 6, metres: 450, estimated: false })).toBe("6 min walk · 450 m by street");
    expect(placeText({ name: "B", straightMetres: 90, minutes: 2, metres: 90, estimated: true })).toBe("~2 min walk (estimate) · 90 m straight line");
    expect(placeText({ name: "High Park", straightMetres: 0, minutes: 0, metres: 0, estimated: false })).toBe("You are in it");
  });
});
