// @vitest-environment jsdom
// The map's population shading follows the year on the timeline: it asks for the new
// year's numbers and never colours the map with the previous year's while they load.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Shading } from "@/lib/shading";
import type { PopulationLayer } from "@/lib/population";

const seen = vi.hoisted(() => ({ shading: [] as (Shading | null | undefined)[] }));
vi.mock("./MapView", () => ({
  default: ({ shading }: { shading?: Shading | null }) => { seen.shading.push(shading); return null; },
}));
vi.mock("./LocationSearch", () => ({ default: () => null }));
vi.mock("@/lib/mapbox", async (importOriginal) => ({ ...await importOriginal<object>(), MAPBOX_TOKEN: "test-token" }));
vi.mock("@/lib/boundaries", async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadBoundaries: async () => ({ type: "FeatureCollection", features: [] }),
}));
const population = vi.hoisted(() => ({ loadPopulation: vi.fn() }));
vi.mock("@/lib/population", async (importOriginal) => ({ ...await importOriginal<object>(), loadPopulation: population.loadPopulation }));

const { default: HousingMap } = await import("./HousingMap");

const layerFor = (year: number): PopulationLayer => ({ year, values: { n1: year * 10 }, source: { title: `Census ${year}`, publisher: "Statistics Canada" } });
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/housing/");
  try { localStorage.clear(); } catch { /* Preferences fall back to memory. */ }
  seen.shading = [];
  population.loadPopulation.mockImplementation(async (_set: string, year: number) => layerFor(year));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function showYear(year: number) {
  await act(async () => {
    root.render(createElement(HousingMap, { selection: { boundarySetId: "toronto-158", geographyId: "n1", year }, onSelectionChange: () => {} }));
  });
}
const latest = () => seen.shading.at(-1);
const legend = () => container.querySelector('[aria-label="Map legend"]')?.textContent ?? "";

it("shades the map with the year on the timeline and names it in the legend", async () => {
  await showYear(2021);
  expect(population.loadPopulation).toHaveBeenLastCalledWith("toronto-158", 2021, expect.any(AbortSignal));
  expect(latest()?.values).toEqual({ n1: 20210 });
  expect(legend()).toContain("Population, 2021");
});

it("switches the shading and the legend when the year changes", async () => {
  await showYear(2021);
  await showYear(2011);
  expect(population.loadPopulation).toHaveBeenLastCalledWith("toronto-158", 2011, expect.any(AbortSignal));
  expect(latest()?.values).toEqual({ n1: 20110 });
  expect(legend()).toContain("Population, 2011");
  expect(legend()).not.toContain("2021");
});

it("shows no shading, rather than the previous year's, while the new year loads", async () => {
  await showYear(2021);
  let finish!: () => void;
  population.loadPopulation.mockImplementationOnce((_set: string, year: number) => new Promise(resolve => { finish = () => resolve(layerFor(year)); }));
  await showYear(2016);
  expect(latest()).toBeNull();
  expect(legend()).toContain("Loading population");
  await act(async () => finish());
  expect(latest()?.values).toEqual({ n1: 20160 });
});
