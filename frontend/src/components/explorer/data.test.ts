import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from './data';

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
  indicators: [380, 245, 378].map((n) => ({
    id: `census-2021-row-${n}`,
    label: 'Fixture',
    unit: n === 378 ? 'percent' : 'CAD/month',
    statistic: 'median',
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
    expect(calls).toHaveLength(3);
    for (const url of calls) {
      expect(url.searchParams.get('source_id')).toBe('census-2021-fixture');
      expect(url.searchParams.get('geography_id')).toBe('toronto-158-1');
    }
  });

  it('refuses a Census year from another boundary set', async () => {
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
