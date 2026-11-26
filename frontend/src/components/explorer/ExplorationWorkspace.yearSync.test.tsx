// @vitest-environment jsdom
// One year choice drives both the map and the details panel. These tests click the real
// timeline and check that the map and the panel always show the same Census year, and
// that a slow answer for an earlier choice never replaces the current one.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoundarySet, ExplorationSelection, NeighbourhoodProfile } from "./types";

// One router for the whole run, as in Next.js; a new one per render would re-run the workspace's loading effect.
const router = vi.hoisted(() => ({ push: () => {}, replace: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The real panel fetches scores, commutes and nearby places; only the profile it is given matters here.
vi.mock("./NeighbourhoodDetailsPanel", async (importOriginal) => ({
  ...await importOriginal<object>(),
  NeighbourhoodDetailsPanel: ({ profile }: { profile: NeighbourhoodProfile }) =>
    createElement("aside", { "data-testid": "panel" }, `${profile.geography.name} ${profile.year}`),
}));
const data = vi.hoisted(() => ({ loadWorkspaceData: vi.fn(), loadProfile: vi.fn() }));
vi.mock("./data", () => data);

const { ExplorationWorkspace } = await import("./ExplorationWorkspace");

const SETS: BoundarySet[] = [{
  id: "toronto-158", label: "Current 158", years: [2001, 2006, 2011, 2016, 2021],
  neighbourhoods: [{ id: "n1", name: "Annex", code: "1" }, { id: "n2", name: "Casa Loma", code: "2" }],
}];
const profileFor = (geographyId: string, year: number) => ({
  geography: { id: geographyId, name: SETS[0].neighbourhoods.find(n => n.id === geographyId)!.name, code: "1", boundary_set: "toronto-158", boundary_version: "158" },
  year, available_years: SETS[0].years,
}) as unknown as NeighbourhoodProfile;

let container: HTMLDivElement;
let root: Root;
let mapSelections: (ExplorationSelection | null)[];
let changeFromMap: (selection: ExplorationSelection) => void;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/housing/?neighbourhood=n1");
  data.loadWorkspaceData.mockResolvedValue({ catalog: {}, boundary_sets: SETS });
  data.loadProfile.mockImplementation(async (_catalog: unknown, id: string, year: number) => profileFor(id, year));
  mapSelections = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderWorkspace() {
  await act(async () => {
    root.render(createElement(ExplorationWorkspace, {
      renderMap: (selection, onChange) => {
        mapSelections.push(selection);
        changeFromMap = onChange;
        return createElement("div", { "data-testid": "map" }, selection ? `${selection.geographyId} ${selection.year}` : "no selection");
      },
    }));
  });
}
const text = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)?.textContent;
const yearButton = (year: number) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Choose a Census year"] button')].find(b => b.textContent === String(year))!;
const timelineStatus = () => container.querySelector('[aria-live="polite"]')?.textContent;
async function click(button: HTMLButtonElement) {
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

it("starts the map and the panel on the same, latest Census year", async () => {
  await renderWorkspace();
  expect(text("map")).toBe("n1 2021");
  expect(text("panel")).toBe("Annex 2021");
  expect(timelineStatus()).toBe("2021 Census");
});

it("moves the map, the panel and the timeline together when a year is chosen", async () => {
  await renderWorkspace();
  await click(yearButton(2011));
  expect(mapSelections.at(-1)).toEqual({ boundarySetId: "toronto-158", geographyId: "n1", year: 2011 });
  expect(data.loadProfile).toHaveBeenLastCalledWith(expect.anything(), "n1", 2011, expect.any(AbortSignal));
  expect(text("panel")).toBe("Annex 2011");
  expect(timelineStatus()).toBe("2011 Census");
  expect(yearButton(2011).getAttribute("aria-pressed")).toBe("true");
});

it("keeps the chosen year when a neighbourhood is picked on the map", async () => {
  await renderWorkspace();
  await click(yearButton(2006));
  await act(async () => changeFromMap({ boundarySetId: "toronto-158", geographyId: "n2", year: 2006 }));
  expect(text("map")).toBe("n2 2006");
  expect(text("panel")).toBe("Casa Loma 2006");
});

it("ignores a map selection for a year the boundary set does not have", async () => {
  await renderWorkspace();
  await act(async () => changeFromMap({ boundarySetId: "toronto-158", geographyId: "n2", year: 1996 }));
  expect(text("map")).toBe("n1 2021");
  expect(text("panel")).toBe("Annex 2021");
});

it("never shows an earlier year's data after a slow response arrives late", async () => {
  await renderWorkspace();
  let finish2016!: (profile: NeighbourhoodProfile) => void;
  data.loadProfile.mockImplementationOnce((_c: unknown, id: string, year: number) => new Promise(resolve => { finish2016 = () => resolve(profileFor(id, year)); }));
  await click(yearButton(2016));
  // The panel waits rather than showing 2021 numbers under a 2016 timeline.
  expect(text("map")).toBe("n1 2016");
  expect(text("panel")).toBeUndefined();
  await click(yearButton(2011));
  expect(text("panel")).toBe("Annex 2011");
  await act(async () => finish2016(profileFor("n1", 2016)));
  expect(text("map")).toBe("n1 2011");
  expect(text("panel")).toBe("Annex 2011");
});
