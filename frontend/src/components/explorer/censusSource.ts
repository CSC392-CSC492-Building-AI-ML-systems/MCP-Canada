/** The census release to read for a year.
 *
 * MCP-Canada first: backend `load_census_from_mcp` saves the census values from
 * MCP-Canada as `mcp-canada-census-<year>` (2006, 2011, 2016, 2021), and
 * `compare_census_sources` checks them against the CSV import. When that source
 * is not loaded (2001 is not in MCP-Canada, or a database set up only with
 * setup_official_data.py), the CSV release `census-<year>-...` is used instead.
 *
 * Returns a list so callers keep their "exactly one release" check. */
export function censusSources<S extends { id: string }>(sources: S[], year: number | string): S[] {
  const mcp = sources.filter(s => s.id === `mcp-canada-census-${year}`);
  return mcp.length ? mcp : sources.filter(s => s.id.startsWith(`census-${year}-`));
}
