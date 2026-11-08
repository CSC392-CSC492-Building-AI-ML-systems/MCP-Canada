import { describe, expect, it } from 'vitest';
import { placeFromSearch, placeHref, type Place } from './mapbox';

const cityHall: Place = { name: 'Toronto City Hall', address: '100 Queen St W', coordinates: [-79.3832, 43.6534] };

describe('landing page place links', () => {
  it('round-trips a place and keeps its neighbourhood', () => {
    const href = placeHref(cityHall, 'toronto-158-170');
    const search = href.slice(href.indexOf('?'));
    expect(new URLSearchParams(search).get('neighbourhood')).toBe('toronto-158-170');
    expect(placeFromSearch(search)).toEqual({ name: '100 Queen St W', address: '100 Queen St W', coordinates: [-79.3832, 43.6534] });
  });

  it('leaves out the neighbourhood when the place is outside every boundary', () => {
    expect(placeHref(cityHall)).not.toContain('neighbourhood=');
  });

  it('ignores a missing, malformed or out-of-Toronto place', () => {
    expect(placeFromSearch('')).toBeNull();
    expect(placeFromSearch('?neighbourhood=toronto-158-1')).toBeNull();
    expect(placeFromSearch('?place=x&lng=abc&lat=43.65')).toBeNull();
    expect(placeFromSearch('?place=x&lng=-79.38&lat=95')).toBeNull();
    expect(placeFromSearch('?place=x&lat=43.65')).toBeNull();
  });
});
