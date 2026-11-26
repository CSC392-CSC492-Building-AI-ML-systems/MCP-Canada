import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRentalBenchmark, RentalContext } from "./RentalContext";
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

describe("rental benchmark validation and failures", () => {
  it.each(["", "all", "0", "4", "../2"])("rejects unsupported bedroom value %j before fetching", async bedrooms => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await loadRentalBenchmark(catalog, bedrooms)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...catalog, indicators: [] },
    { ...catalog, sources: [] },
    { ...catalog, geographies: [] },
    { ...catalog, indicators: [{ ...catalog.indicators[0], id: "cmhc-2025-apartment-vacancy-2" }] },
  ])("requires rental indicators, a unique release and the edition's CMA", async incomplete => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await loadRentalBenchmark(incomplete, "2")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("selects the newest edition even when indicators arrive unsorted", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations: [row] }) });
    vi.stubGlobal("fetch", fetcher);
    const mixed = { ...catalog, indicators: [
      { ...catalog.indicators[0], id: "cmhc-2023-apartment-rent-2" },
      catalog.indicators[0],
      { ...catalog.indicators[0], id: "cmhc-2024-apartment-rent-2" },
    ] };
    const result = await loadRentalBenchmark(mixed, "2");
    expect(result).toEqual({ value: 2690, year: 2025, source: catalog.sources[0], notes: "" });
    expect(fetcher.mock.calls[0][0]).toContain("indicator_id=cmhc-2025-apartment-rent-2");
  });

  it.each(["studio", "1", "3plus"])("uses the requested %s bedroom series and preserves reliability notes", async bedrooms => {
    const signal = new AbortController().signal;
    const notes = "CMHC published geography; source reliability code: b";
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations: [{ ...row, notes }] }) });
    vi.stubGlobal("fetch", fetcher);
    const selected = { ...catalog, indicators: [{ ...catalog.indicators[0], id: `cmhc-2025-apartment-rent-${bedrooms}` }] };
    expect((await loadRentalBenchmark(selected, bedrooms, signal))?.notes).toBe(notes);
    expect(new URL(fetcher.mock.calls[0][0], "http://localhost").searchParams.get("indicator_id"))
      .toBe(`cmhc-2025-apartment-rent-${bedrooms}`);
    expect(fetcher.mock.calls[0][1]).toEqual({ signal });
  });

  it.each([
    [],
    [{ ...row, reference_year: 2024 }],
    [{ ...row, period: "annual" }],
    [{ ...row, status: "missing" }],
    [{ ...row, value: null }],
    [{ ...row, value: "NaN" }],
    [{ ...row, value: "Infinity" }],
    [{ ...row, value: "-1" }],
  ].map(observations => ({ observations })))("keeps absent, wrong-period and invalid observations unavailable", async ({ observations }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations }) }));
    expect(await loadRentalBenchmark(catalog, "2")).toBeNull();
  });

  it("preserves a published zero rather than treating it as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ observations: [{ ...row, value: "0" }] }) }));
    expect((await loadRentalBenchmark(catalog, "2"))?.value).toBe(0);
  });

  it("reports an unsuccessful HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadRentalBenchmark(catalog, "2")).rejects.toThrow("CMHC rental context could not be loaded.");
  });

  it("propagates network and cancellation errors to the component", async () => {
    const error = new Error("Network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(loadRentalBenchmark(catalog, "2")).rejects.toBe(error);
    const aborted = new DOMException("Cancelled", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));
    await expect(loadRentalBenchmark(catalog, "2")).rejects.toBe(aborted);
  });
});

describe("rental context initial rendering", () => {
  it("explains when the catalogue is unavailable", () => {
    const html = renderToStaticMarkup(createElement(RentalContext, { catalog: null }));
    expect(html).toContain("Rental catalogue unavailable.");
    expect(html).not.toContain("Toronto CMA average rent");
  });
  it("shows loading and bedroom choices before the request resolves", () => {
    const html = renderToStaticMarkup(createElement(RentalContext, { catalog }));
    expect(html).toContain("Loading CMHC rental context");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('value="2" selected');
    expect(html).toContain("Studio");
    expect(html).toContain("3+ bedrooms");
    expect(html).not.toContain("$2,690");
  });
});
