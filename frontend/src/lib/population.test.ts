import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPopulation } from './population';

// Synthetic fixture: not real Census values.
const catalog = { sources: [
  { id: 'census-2016-fixture', title: 'Synthetic fixture', publisher: 'Test' },
  { id: 'census-2021-fixture', title: 'Synthetic fixture', publisher: 'Test' },
] };

function mockFetch(observations: unknown[]): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => (String(url).startsWith('/api/catalog/') ? catalog : { observations }) };
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('loadPopulation', () => {
  it('loads every neighbourhood in the set from the reviewed row; suppressed stays unknown', async () => {
    const calls = mockFetch([
      { geography_id: 'toronto-140-1', value: '20000.00000000', status: 'observed', census_year: 2016 },
      { geography_id: 'toronto-140-2', value: null, status: 'suppressed', census_year: 2016 },
      { geography_id: 'toronto-140-3', value: '0', status: 'observed', census_year: 2016 },
    ]);
    const layer = await loadPopulation('toronto-140', 2016);
    expect(layer.values).toEqual({ 'toronto-140-1': 20000, 'toronto-140-2': null, 'toronto-140-3': 0 });
    expect(layer.note).toBeUndefined();
    const url = calls.find((u) => u.startsWith('/api/observations/'));
    expect(url).toMatch(/indicator_id=census-2016-row-4/);
    expect(url).toMatch(/geography_set_id=toronto-140/);
    expect(url).toMatch(/source_id=census-2016-fixture/);
  });

  it('2021 carries the sample-data note', async () => {
    mockFetch([]);
    expect((await loadPopulation('toronto-158', 2021)).note).toMatch(/25% sample/);
  });

  it('a year without a reviewed row is refused', async () => {
    await expect(loadPopulation('toronto-140', 1996)).rejects.toThrow(/No reviewed population row/);
  });
});
