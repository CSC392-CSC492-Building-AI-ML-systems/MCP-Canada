import { describe, expect, it } from "vitest";
import { placeKey, type AmenityList, type Walking } from "@/lib/amenities";
import type { Boundaries } from "@/lib/boundaries";
import { amenityPoints, nearbyOrigin } from "./NearbyAmenities";

const feature: Boundaries["features"][number] = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[-79.41, 43.64], [-79.39, 43.64], [-79.39, 43.66], [-79.41, 43.66], [-79.41, 43.64]]] },
  properties: { geography_id: "toronto-158-1", code: "1", name: "Test area" },
};
const school = (name: string, lat: number): AmenityList["places"][number] =>
  ({ category: "school", name, coordinates: [-79.4, lat], validOn: "2026-10-27", kind: null });
const loaded = (places: AmenityList["places"]): AmenityList => ({ category: "school", loaded: true, places, source: { title: "School locations", publisher: "City of Toronto" } });

describe("nearbyOrigin", () => {
  it("measures from a searched address inside the neighbourhood", () => {
    expect(nearbyOrigin(feature, [-79.405, 43.645])).toEqual({ point: [-79.405, 43.645], label: "your searched address" });
  });
  it("otherwise measures from the neighbourhood's centre", () => {
    const origin = nearbyOrigin(feature, [-79.2, 43.7]);
    expect(origin.label).toBe("the centre of Test area");
    expect(origin.point[0]).toBeCloseTo(-79.4);
    expect(origin.point[1]).toBeCloseTo(43.65);
  });
});

describe("amenityPoints", () => {
  it("adds the street walk to points that have one", () => {
    const near = school("Near", 43.651);
    const walking: Walking = { status: "ok", routes: { [placeKey("school", near.name, near.coordinates)]: { minutes: 3, metres: 210 } } };
    const points = amenityPoints({ school: { key: "k", list: loaded([near]) } } as never, { point: [-79.4, 43.65], label: "x" }, walking);
    expect(points.features[0].properties).toMatchObject({ metres: 111, walk_minutes: 3, walk_metres: 210 });
  });
  it("turns loaded places into map points with their distance", () => {
    const points = amenityPoints({ school: { key: "k", list: loaded([school("Near", 43.651)]) } } as never, { point: [-79.4, 43.65], label: "x" });
    expect(points.features).toHaveLength(1);
    expect(points.features[0].properties).toMatchObject({ category: "school", name: "Near", label: "Schools", metres: 111 });
  });
});

