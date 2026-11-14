import { afterEach, expect, it, vi } from "vitest";
import { loadCostRows } from "./recommendation-data";
import type { Catalog } from "../explorer/data";
const catalog: Catalog = {
  sources: [{ id: "census-2021-reviewed", title: "Test", publisher: "Test", url: "https://example.org", coverage: "Test" }],
  indicators: [], geographies: [{ id: "toronto-158-2", name: "Test place", code: "2", geography_set_id: "toronto-158", geography_set__kind: "neighbourhood", geography_set__version: "158" }],
};
afterEach(() => vi.unstubAllGlobals());
it("uses existing observations when the optional batch endpoint is absent", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("Not found", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ observations: [{ census_year: 2021, period: "annual", value: "1200", status: "observed", source_locator: "fixture" }] })));
  vi.stubGlobal("fetch", fetcher);
  const rows = await loadCostRows(catalog);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ geography_id: "toronto-158-2", name: "Test place", value: "1200" });
  const url = new URL(fetcher.mock.calls[1][0], "http://localhost");
  expect(url.pathname).toBe("/api/observations/");
  expect(url.searchParams.get("source_id")).toBe("census-2021-reviewed");
  expect(url.searchParams.get("indicator_id")).toBe("census-2021-row-380");
});
it("does not turn ambiguous observations into recommendation data", async () => {
  const duplicate = { census_year: 2021, period: "annual", value: "1200", status: "observed", source_locator: "fixture" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ observations: [duplicate, duplicate] }))));
  expect(await loadCostRows(catalog)).toEqual([]);
});

it("uses the batch endpoint when available and requests the reviewed boundary set", async () => {
  const rows = [{ geography_id: "toronto-158-2", name: "Test place", value: "1200", status: "observed", census_year: 2021, source_locator: "fixture" }];
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ observations: rows })));
  vi.stubGlobal("fetch", fetcher);

  await expect(loadCostRows(catalog)).resolves.toEqual(rows);

  const url = new URL(fetcher.mock.calls[0][0], "http://localhost");
  expect(url.pathname).toBe("/api/observations/batch/");
  expect(url.searchParams.get("geography_set_id")).toBe("toronto-158");
});

it("fails clearly when a batch request fails instead of masking the error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

  await expect(loadCostRows(catalog)).rejects.toThrow("Could not load housing benchmarks.");
});

it("requires exactly one reviewed 2021 release before making requests", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);

  await expect(loadCostRows({
    ...catalog,
    sources: [...catalog.sources, { ...catalog.sources[0], id: "census-2021-other" }],
  })).rejects.toThrow("A unique reviewed 2021 Census release is required.");
  expect(fetcher).not.toHaveBeenCalled();
});
