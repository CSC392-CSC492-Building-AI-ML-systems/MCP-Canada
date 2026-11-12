import { describe, expect, it } from 'vitest';
import { findAtSameLocation, findBoundary, type Boundaries, type BoundaryGeometry } from './boundaries';
import type { LngLat } from './mapbox';

const square = (x0: number, y0: number, x1: number, y1: number): LngLat[] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const feature = (id: string, geometry: BoundaryGeometry): Boundaries['features'][number] =>
  ({ type: 'Feature', geometry, properties: { geography_id: id, code: id, name: id } });
const boundaries: Boundaries = {
  type: 'FeatureCollection',
  features: [
    feature('donut', { type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)] }),
    feature('islands', { type: 'MultiPolygon', coordinates: [[square(20, 0, 21, 1)], [square(25, 5, 26, 6)]] }),
  ],
};

describe('findBoundary', () => {
  it('finds the neighbourhood containing a point, including any part of a split one', () => {
    expect(findBoundary(boundaries, [1, 1])?.properties.geography_id).toBe('donut');
    expect(findBoundary(boundaries, [25.5, 5.5])?.properties.geography_id).toBe('islands');
  });

  it('matches nothing for a point in a hole or outside every boundary', () => {
    expect(findBoundary(boundaries, [5, 5])).toBeUndefined();
    expect(findBoundary(boundaries, [15, 5])).toBeUndefined();
  });
});

describe('findAtSameLocation', () => {
  const source: Boundaries = {
    type: 'FeatureCollection',
    features: [
      feature('west', { type: 'Polygon', coordinates: [square(0, 0, 2, 2)] }),
      feature('lake', { type: 'Polygon', coordinates: [square(100, 100, 102, 102)] }),
    ],
  };
  const target: Boundaries = {
    type: 'FeatureCollection',
    features: [
      feature('other-code', { type: 'Polygon', coordinates: [square(0, 0, 5, 5)] }),
    ],
  };

  it('finds the neighbourhood covering the centre of the current one', () => {
    expect(findAtSameLocation(source, 'west', target)?.properties.geography_id).toBe('other-code');
  });

  it('matches nothing when the centre is outside the new set or the neighbourhood is unknown', () => {
    expect(findAtSameLocation(source, 'lake', target)).toBeUndefined();
    expect(findAtSameLocation(source, 'missing', target)).toBeUndefined();
  });
});
