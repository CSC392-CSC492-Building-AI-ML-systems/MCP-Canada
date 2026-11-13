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
