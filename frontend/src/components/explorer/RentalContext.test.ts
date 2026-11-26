import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRentalBenchmark } from "./RentalContext";
import type { Catalog } from "./data";

const catalog = {
  sources: [{ id: "cmhc-toronto-2025-xlsx-reviewed", title: "2025 workbook", publisher: "CMHC", coverage: "CMA", url: "https://example.com" }],
  indicators: [{ id: "cmhc-2025-apartment-rent-2" }],
  geographies: [{ id: "cmhc-toronto-2025" }],
} as Catalog;
const row = { value: "2690", status: "observed", reference_year: 2025, period: "2025-10" };
afterEach(() => vi.unstubAllGlobals());
describe("regional rental context", () => {
  it("requests the edition's CMA and year, excluding the previous year in the same table", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations: [{ ...row, reference_year: 2024, period: "2024-10", value: "2500" }, row] }) });
    vi.stubGlobal("fetch", fetcher);
    expect((await loadRentalBenchmark(catalog, "2"))?.value).toBe(2690);
    const params = new URL(fetcher.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.get("geography_id")).toBe("cmhc-toronto-2025");
    expect(params.get("source_id")).toBe(catalog.sources[0].id);
  });
  it("keeps suppressed and duplicate values unavailable", async () => {
    for (const observations of [[{ ...row, status: "suppressed", value: null }], [row, row]]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations }) }));
      expect(await loadRentalBenchmark(catalog, "2")).toBeNull();
    }
  });
  it("does not arbitrarily pick among two source releases", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await loadRentalBenchmark({ ...catalog, sources: [...catalog.sources, { ...catalog.sources[0], id: "cmhc-toronto-2025-xlsx-other" }] }, "2")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
