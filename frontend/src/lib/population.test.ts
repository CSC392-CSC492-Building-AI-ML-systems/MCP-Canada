import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPopulation, resetPopulationCache } from './population';

// Synthetic fixture: not real Census values.
const catalog = {
  sources: [
    { id: 'census-2016-fixture', title: 'Synthetic fixture', publisher: 'Test' },
    { id: 'census-2021-fixture', title: 'Synthetic fixture', publisher: 'Test' },
  ],
  boundary_links: [
    { id: 'toronto-158-1', parent: 'toronto-140-1', relation: 'same' },
    { id: 'toronto-158-2', parent: 'toronto-140-2', relation: 'part' },
    { id: 'toronto-158-3', parent: 'toronto-140-2', relation: 'part' },
  ],
};

function mockFetch(observations: unknown[]): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => (String(url).startsWith('/api/catalog/') ? catalog : { observations }) };
  });
  return calls;
}
const row = (geography_id: string, value: string | null, census_year = 2016, status = value === null ? 'suppressed' : 'observed') =>
  ({ geography_id, value, status, census_year, period: 'annual' });

afterEach(() => { vi.unstubAllGlobals(); resetPopulationCache(); });

describe('loadPopulation', () => {
  it('loads every neighbourhood in the set from the reviewed row; suppressed stays unknown', async () => {
    const calls = mockFetch([row('toronto-140-1', '20000.00000000'), row('toronto-140-2', null), row('toronto-140-3', '0')]);
    const layer = await loadPopulation('toronto-140', 2016);
    expect(layer.values).toEqual({ 'toronto-140-1': 20000, 'toronto-140-2': null, 'toronto-140-3': 0 });
    expect(layer.note).toBeUndefined();
    const url = calls.find((u) => u.startsWith('/api/observations/batch/'));
    expect(url).toMatch(/indicator_id=census-2016-row-4/);
    expect(url).toMatch(/geography_set_id=toronto-140/);
    expect(url).toMatch(/source_id=census-2016-fixture/);
  });

  it('2021 carries the sample-data note', async () => {
    mockFetch([]);
    expect((await loadPopulation('toronto-158', 2021)).note).toMatch(/25% sample/);
  });

  it('shades earlier years on the current boundaries only where the area did not change', async () => {
    const calls = mockFetch([row('toronto-140-1', '15000'), row('toronto-140-2', '40000')]);
    const layer = await loadPopulation('toronto-158', 2016);
    // The split area's parent value is never given to its smaller parts.
    expect(layer.values).toEqual({ 'toronto-158-1': 15000, 'toronto-158-2': null, 'toronto-158-3': null });
    expect(calls.find((u) => u.startsWith('/api/observations/batch/'))).toMatch(/geography_set_id=toronto-140/);
  });

  it('a year without a reviewed row is refused', async () => {
    await expect(loadPopulation('toronto-140', 1996)).rejects.toThrow(/No reviewed population row/);
  });
});
