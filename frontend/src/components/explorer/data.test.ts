import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundarySetYears, loadProfile, type Catalog } from './data';

const source = {
  id: 'census-2021-fixture',
  title: 'Synthetic fixture',
  publisher: 'Test',
  url: 'https://example.org',
  coverage: 'Test',
};
const catalog = {
  sources: [source],
  geographies: [{
    id: 'toronto-158-1',
    name: 'Synthetic test area',
    code: '1',
    geography_set_id: 'toronto-158',
    geography_set__kind: 'neighbourhood',
    geography_set__version: '158',
  }],
  indicators: [381, 246, 378, 4].map((n) => ({
    id: `census-2021-row-${n}`,
    label: 'Fixture',
    unit: n === 378 ? 'percent' : 'CAD/month',
    statistic: 'average',
    universe: 'Test',
  })),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadProfile', () => {
  it('uses the explicit source and geography, deduplicates history requests, and preserves zero', async () => {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      calls.push(new URL(String(input), 'http://localhost'));
      return new Response(JSON.stringify({
        observations: [{
          value: '0',
          status: 'observed',
          census_year: 2021,
          reference_year: 2021,
          period: 'annual',
          source_locator: 'fixture',
        }],
      }), { status: 200 });
    }));

    const profile = await loadProfile(catalog, 'toronto-158-1', 2021);

    expect(profile.metrics.cost.value).toBe('0');
    expect(profile.history[0].cost.value).toBe('0');
    // cost, income, burden and population once each: history reuses the selected year's requests.
    expect(calls).toHaveLength(4);
    for (const url of calls) {
      expect(url.searchParams.get('source_id')).toBe('census-2021-fixture');
      expect(url.searchParams.get('geography_id')).toBe('toronto-158-1');
    }
  });

  it('refuses a Census year that is not loaded', async () => {
    await expect(loadProfile(catalog, 'toronto-158-1', 2011))
      .rejects.toThrow('This year is unavailable on the selected boundary set.');
  });

  it('keeps multiple releases unavailable instead of silently choosing one', async () => {
    const profile = await loadProfile({
      ...catalog,
      sources: [source, { ...source, id: 'census-2021-other' }],
    }, 'toronto-158-1', 2021);

    expect(profile.metrics.cost.value).toBeNull();
    expect(profile.metrics.cost.status).toBe('missing');
    expect(profile.metrics.cost.source).toBeNull();
  });

  it('keeps suppressed values unavailable and explains the published status', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        observations: [{
          value: null,
          status: 'suppressed',
          census_year: 2021,
          reference_year: 2021,
          period: 'annual',
          source_locator: 'fixture',
        }],
      }),
      { status: 200 },
    )));

    const profile = await loadProfile(catalog, 'toronto-158-1', 2021);

    expect(profile.metrics.cost.value).toBeNull();
    expect(profile.metrics.cost.status).toBe('suppressed');
    expect(profile.metrics.cost.reason).toBe('The published source cell is unavailable or suppressed.');
  });

  it('uses only annual observations for the selected Census year', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        observations: [
          {
            value: '10',
            status: 'observed',
            census_year: 2021,
            reference_year: 2021,
            period: 'monthly',
            source_locator: 'fixture/monthly',
          },
          {
            value: '20',
            status: 'observed',
            census_year: 2016,
            reference_year: 2016,
            period: 'annual',
            source_locator: 'fixture/older-year',
          },
          {
            value: '30',
            status: 'observed',
            census_year: 2021,
            reference_year: 2021,
            period: 'annual',
            source_locator: 'fixture/selected',
          },
        ],
      }),
      { status: 200 },
    )));

    const profile = await loadProfile(catalog, 'toronto-158-1', 2021);

    expect(profile.metrics.cost.value).toBe('30');
    expect(profile.metrics.cost.source_locator).toBe('fixture/selected');
  });

  it('marks duplicate annual observations unavailable rather than choosing one', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({
        observations: [10, 20].map((value) => ({
          value: String(value),
          status: 'observed',
          census_year: 2021,
          reference_year: 2021,
          period: 'annual',
          source_locator: 'fixture',
        })),
      }),
      { status: 200 },
    )));

    const profile = await loadProfile(catalog, 'toronto-158-1', 2021);

    expect(profile.metrics.cost.value).toBeNull();
    expect(profile.metrics.cost.status).toBe('missing');
    expect(profile.metrics.cost.reason).toBe('No unique published observation is available.');
  });
});

describe('across the 2021 boundary change', () => {
  const area = (id: string, name: string, code: string) => ({
    id, name, code, geography_set_id: id.replace(/-\d+$/, ''), geography_set__kind: 'neighbourhood', geography_set__version: 'x',
  });
  const twoSets: Catalog = {
    sources: [{ ...source, id: 'census-2011-fixture' }, source],
    geographies: [
      area('toronto-140-1', 'Unchanged', '1'), area('toronto-140-2', 'Niagara', '82'),
      area('toronto-158-1', 'Unchanged', '1'), area('toronto-158-2', 'West Queen West', '162'),
      area('toronto-158-3', 'Fort York-Liberty Village', '163'),
    ],
    indicators: [1367, 758, 1365, 2, 381, 246, 378, 4].map(n => ({
      id: `census-${n > 1000 || n === 758 || n === 2 ? 2011 : 2021}-row-${n}`, label: 'Fixture', unit: 'CAD/month', statistic: 'average', universe: 'Test',
    })),
    boundary_links: [
      { id: 'toronto-158-1', parent: 'toronto-140-1', relation: 'same' },
      { id: 'toronto-158-2', parent: 'toronto-140-2', relation: 'part' },
      { id: 'toronto-158-3', parent: 'toronto-140-2', relation: 'part' },
    ],
  };
  function serve() {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      calls.push(url);
      const year = Number(url.searchParams.get('indicator_id')!.slice(7, 11));
      return new Response(JSON.stringify({ observations: [{
        value: url.searchParams.get('geography_id') === 'toronto-140-2' && year === 2021 ? '1952.62' : '1000',
        status: 'observed', census_year: year, reference_year: year, period: 'annual', source_locator: 'fixture',
        ...(url.searchParams.get('geography_id') === 'toronto-140-2' && year === 2021
          ? { derived: { relation: 'combined', method: 'Average of the 2021 values for its parts.', parts: ['West Queen West', 'Fort York-Liberty Village'] } } : {}),
      }] }), { status: 200 });
    }));
    return calls;
  }

  it('puts 2021 on the earlier boundaries only when the backend links the sets', () => {
    expect(boundarySetYears(twoSets, 'toronto-140')).toEqual([2011, 2021]);
    expect(boundarySetYears({ ...twoSets, boundary_links: undefined }, 'toronto-140')).toEqual([2011]);
    expect(boundarySetYears(twoSets, 'toronto-158')).toEqual([2011, 2021]);
  });

  it('compares 2021 with earlier years on the same earlier boundary, including a split area', async () => {
    const calls = serve();
    const profile = await loadProfile(twoSets, 'toronto-140-2', 2021);
    expect(profile.available_years).toEqual([2011, 2021]);
    expect(profile.metrics.cost.value).toBe('1952.62');
    expect(profile.metrics.cost.derived?.relation).toBe('combined');
    expect(profile.data_geography).toBeUndefined();
    expect(new Set(calls.map(url => url.searchParams.get('geography_id')))).toEqual(new Set(['toronto-140-2']));
    expect(profile.boundary_note).toContain('West Queen West, Fort York-Liberty Village');
  });

  it('shows earlier years for an unchanged current area from its identical earlier area', async () => {
    const calls = serve();
    const profile = await loadProfile(twoSets, 'toronto-158-1', 2011);
    expect(profile.available_years).toEqual([2011, 2021]);
    expect(profile.data_geography).toEqual({ id: 'toronto-140-1', name: 'Unchanged', boundary_set: 'toronto-140' });
    const byYear = (y: string) => calls.filter(u => u.searchParams.get('indicator_id')!.startsWith(`census-${y}`)).map(u => u.searchParams.get('geography_id'));
    expect(new Set(byYear('2011'))).toEqual(new Set(['toronto-140-1']));
    expect(new Set(byYear('2021'))).toEqual(new Set(['toronto-158-1']));
  });

  it('never gives a split current area its larger parent area\'s earlier values', async () => {
    const calls = serve();
    const profile = await loadProfile(twoSets, 'toronto-158-2', 2011);
    expect(profile.available_years).toEqual([2021]);
    expect(profile.metrics.cost).toMatchObject({ value: null, status: 'missing' });
    expect(profile.metrics.cost.reason).toContain('part of Niagara');
    expect(calls.some(u => u.searchParams.get('indicator_id')!.startsWith('census-2011'))).toBe(false);
    expect(profile.boundary_note).toContain('split Niagara');
  });
});
