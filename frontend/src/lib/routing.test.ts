import { afterEach, describe, expect, it, vi } from 'vitest';
import { representativePoint } from './boundaries';
import { clockLabel, commuteScore, routeSummary } from './routing';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('commuteScore', () => {
  it('is 100 at half the limit, 50 at it and 0 at 1.5 times it', () => {
    expect(commuteScore(15, 30)).toBe(100);
    expect(commuteScore(5, 30)).toBe(100);
    expect(commuteScore(30, 30)).toBe(50);
    expect(commuteScore(45, 30)).toBe(0);
    expect(commuteScore(90, 30)).toBe(0);
  });
  it('gives no score without a time or a limit, never zero', () => {
    expect(commuteScore(null, 30)).toBeNull();
    expect(commuteScore(20, 0)).toBeNull();
  });
});

describe('labels', () => {
  it('formats clock times and route lists', () => {
    expect(clockLabel('08:05')).toBe('8:05 AM');
    expect(clockLabel('12:30')).toBe('12:30 PM');
    expect(clockLabel('00:10')).toBe('12:10 AM');
    expect(routeSummary([
      { route: '54', name: 'Lawrence East', mode: 'bus', board: '', alight: '', depart: '', arrive: '' },
      { route: '2', name: 'Bloor-Danforth', mode: 'subway', board: '', alight: '', depart: '', arrive: '' },
    ])).toBe('54 → Line 2');
  });
});

describe('representativePoint', () => {
  it('uses the centroid when it is inside the area', () => {
    const [x, y] = representativePoint({ type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] });
    expect(x).toBeCloseTo(2); expect(y).toBeCloseTo(1);
  });
  it('stays inside a U-shaped area whose centroid falls in the gap', () => {
    const u: [number, number][] = [[0, 0], [10, 0], [10, 10], [8, 10], [8, 2], [2, 2], [2, 10], [0, 10], [0, 0]];
    const [x, y] = representativePoint({ type: 'Polygon', coordinates: [u] });
    expect(x < 2 || x > 8 || y < 2).toBe(true);
  });
  it('picks the largest part of a split area', () => {
    const [x] = representativePoint({ type: 'MultiPolygon', coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]]] });
    expect(x).toBeCloseTo(15);
  });
});

describe('commuteTimes', () => {
  const origins = [{ id: 'a', coordinates: [-79.40, 43.70] as [number, number] }, { id: 'b', coordinates: [-79.30, 43.75] as [number, number] }];

  it('asks Mapbox for one matrix to the destination and keeps unroutable places as gaps', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'pk.test');
    const fetchMock = vi.fn().mockResolvedValue(json({ code: 'Ok', durations: [[1260], [null]], distances: [[5400], [null]] }));
    vi.stubGlobal('fetch', fetchMock);
    const { commuteTimes } = await import('./routing');
    const result = await commuteTimes('Bike', origins, [-79.38, 43.65]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/directions-matrix/v1/mapbox/cycling/-79.400000,43.700000;-79.300000,43.750000;-79.380000,43.650000');
    expect(url.searchParams.get('sources')).toBe('0;1');
    expect(url.searchParams.get('destinations')).toBe('2');
    expect(result.byId.a).toEqual({ minutes: 21, km: 5.4 });
    expect(result.byId.b.minutes).toBeNull();
  });

  it('needs a Mapbox token for walking, cycling and driving', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '');
    const { commuteTimes, CommuteUnavailable } = await import('./routing');
    await expect(commuteTimes('Walk', origins, [-79.38, 43.65])).rejects.toBeInstanceOf(CommuteUnavailable);
  });

  it('posts transit trips to the backend and reads the schedule result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      status: 'ok', service_date: '2026-11-03', arrive_by: '09:00', method: 'Published TTC weekday schedule.',
      source: { id: 'ttc-gtfs-1', title: 'TTC', publisher: 'TTC', url: 'https://example.org', version: '1' },
      results: [{ id: 'a', minutes: 42, leave_by: '08:18', walk_only: false, legs: [] }, { id: 'b', minutes: null, reason: 'No trip' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { commuteTimes } = await import('./routing');
    const result = await commuteTimes('Transit', origins, [-79.38, 43.65]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/transit/commute/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).destination).toEqual({ lng: -79.38, lat: 43.65 });
    expect(result.byId.a).toMatchObject({ minutes: 42, leaveBy: '08:18', walkOnly: false });
    expect(result.byId.b).toEqual({ minutes: null, reason: 'No trip' });
    expect(result.arriveBy).toBe('09:00');
  });

  it('reports the backend reason when the transit index is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'unavailable', error: 'Run build_transit_index.' }, 503)));
    const { commuteTimes } = await import('./routing');
    await expect(commuteTimes('Transit', origins, [-79.38, 43.65])).rejects.toThrow('Run build_transit_index.');
  });
});
