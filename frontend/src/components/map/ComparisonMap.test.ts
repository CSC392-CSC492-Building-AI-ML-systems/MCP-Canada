import { expect, it, vi } from "vitest";
vi.mock("@/lib/boundaries", () => ({ loadBoundaries: vi.fn() }));
import { loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { comparisonBoundaries } from "./ComparisonMap";
const empty: Boundaries = { type: "FeatureCollection", features: [] };

it("shares one boundary download between comparison maps in the same set", async () => {
  vi.mocked(loadBoundaries).mockResolvedValueOnce(empty);
  const first = comparisonBoundaries("shared-set");
  const second = comparisonBoundaries("shared-set");
  expect(first).toBe(second);
  expect(await first).toBe(empty);
  expect(vi.mocked(loadBoundaries).mock.calls.filter(([id]) => id === "shared-set")).toHaveLength(1);
});
it("allows a failed boundary download to be retried", async () => {
  vi.mocked(loadBoundaries).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(empty);
  await expect(comparisonBoundaries("retry-set")).rejects.toThrow("Offline");
  await expect(comparisonBoundaries("retry-set")).resolves.toBe(empty);
  expect(vi.mocked(loadBoundaries).mock.calls.filter(([id]) => id === "retry-set")).toHaveLength(2);
});
