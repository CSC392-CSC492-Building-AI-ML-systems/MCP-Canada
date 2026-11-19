import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./mapbox", () => ({ MAPBOX_TOKEN: "pk.test" }));
const { clearWalkingCache, walkingRoutes } = await import("./walking");

afterEach(() => { vi.unstubAllGlobals(); clearWalkingCache(); });

function matrix(durations: (number | null)[], distances: (number | null)[]) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    calls.push(new URL(input));
    return new Response(JSON.stringify({ code: "Ok", durations: [durations], distances: [distances] }));
  });
  return calls;
}

describe("walkingRoutes", () => {
  const origin: [number, number] = [-79.4, 43.65];
  const a = { key: "a", coordinates: [-79.41, 43.66] as [number, number] };
  const b = { key: "b", coordinates: [-79.39, 43.64] as [number, number] };

  it("asks Mapbox for walking routes from one origin to every place", async () => {
    const calls = matrix([367, null], [512.4, null]);
    const routes = await walkingRoutes(origin, [a, b]);
    expect(calls[0].pathname).toBe("/directions-matrix/v1/mapbox/walking/-79.400000,43.650000;-79.410000,43.660000;-79.390000,43.640000");
    expect(calls[0].searchParams.get("sources")).toBe("0");
    expect(calls[0].searchParams.get("destinations")).toBe("1;2");
    expect(calls[0].searchParams.get("annotations")).toBe("duration,distance");
    // 367 s is 6 minutes; a place with no walking route is null, not zero.
    expect(routes).toEqual({ a: { minutes: 6, metres: 512 }, b: null });
  });
  it("remembers routes for the visit instead of asking again", async () => {
    const calls = matrix([60], [80]);
    await walkingRoutes(origin, [a]);
    expect(await walkingRoutes(origin, [{ ...a, key: "again" }])).toEqual({ again: { minutes: 1, metres: 80 } });
    expect(calls).toHaveLength(1);
  });
  it("splits more than 24 places across requests", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: String(i), coordinates: [-79.4 + i / 1000, 43.66] as [number, number] }));
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); calls.push(url);
      const n = url.searchParams.get("destinations")!.split(";").length;
      return new Response(JSON.stringify({ code: "Ok", durations: [Array(n).fill(120)], distances: [Array(n).fill(150)] }));
    });
    const routes = await walkingRoutes(origin, many);
    expect(calls.map((c) => c.searchParams.get("destinations")!.split(";").length)).toEqual([24, 6]);
    expect(Object.keys(routes)).toHaveLength(30);
  });
  it("reports a Mapbox failure so the app can fall back to estimates", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "InvalidInput", message: "Too many coordinates" }), { status: 422 }));
    await expect(walkingRoutes(origin, [a])).rejects.toThrow("Mapbox could not calculate walking times (Too many coordinates).");
  });
});
