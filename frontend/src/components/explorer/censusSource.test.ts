import { describe, expect, it } from 'vitest';
import { censusSources } from './censusSource';

const csv2001 = { id: 'census-2001-csv-8d3542c5b0' };
const csv2016 = { id: 'census-2016-csv-9d45a882dd' };
const mcp2016 = { id: 'mcp-canada-census-2016' };
const cpi = { id: 'cpi-json-4f9ac5e9f9' };

describe('censusSources', () => {
  it('prefers the MCP-Canada release when it is loaded', () => {
    expect(censusSources([csv2016, mcp2016, cpi], 2016)).toEqual([mcp2016]);
  });
  it('falls back to the CSV release when MCP-Canada is not loaded', () => {
    expect(censusSources([csv2016, cpi], 2016)).toEqual([csv2016]);
  });
  it('uses the CSV for 2001, which MCP-Canada does not have', () => {
    expect(censusSources([csv2001, csv2016, mcp2016], 2001)).toEqual([csv2001]);
  });
  it('accepts the year as a string', () => {
    expect(censusSources([csv2016, mcp2016], '2016')).toEqual([mcp2016]);
  });
  it('never mixes years', () => {
    expect(censusSources([mcp2016], 2021)).toEqual([]);
  });
});
