"use client";

import { useEffect, useMemo, useState } from "react";
import type { Catalog } from "./data";
import styles from "./explorer.module.css";

export type RentalBenchmark = { value: number; year: number; source: Catalog["sources"][number]; notes: string };
type RentalRow = { value: string | null; status: string; reference_year: number; period: string; notes?: string };

/** Choose one workbook edition explicitly, then exactly one observed value for that edition's year. */
export async function loadRentalBenchmark(catalog: Catalog, bedrooms: string, signal?: AbortSignal): Promise<RentalBenchmark | null> {
  if (!["studio", "1", "2", "3plus"].includes(bedrooms)) return null;
  const editions = catalog.indicators.flatMap(i => {
    const match = i.id.match(new RegExp(`^cmhc-(\\d{4})-apartment-rent-${bedrooms}$`));
    return match ? [Number(match[1])] : [];
  }).sort((a, b) => b - a);
  const year = editions[0];
  if (!year) return null;
  const sources = catalog.sources.filter(s => s.id.startsWith(`cmhc-toronto-${year}-xlsx-`));
  if (sources.length !== 1 || !catalog.geographies.some(g => g.id === `cmhc-toronto-${year}`)) return null;
  const source = sources[0];
  const params = new URLSearchParams({
    geography_id: `cmhc-toronto-${year}`, indicator_id: `cmhc-${year}-apartment-rent-${bedrooms}`, source_id: source.id,
  });
  const response = await fetch(`/api/observations/?${params}`, { signal });
  if (!response.ok) throw new Error("CMHC rental context could not be loaded.");
  const data: { observations: RentalRow[] } = await response.json();
  const matches = data.observations.filter(o => o.reference_year === year && o.period === `${year}-10`);
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (row.status !== "observed" || row.value === null || !Number.isFinite(Number(row.value)) || Number(row.value) < 0) return null;
  return { value: Number(row.value), year, source, notes: row.notes ?? "" };
}

export function RentalContext({ catalog }: { catalog: Catalog | null | undefined }) {
  const [bedrooms, setBedrooms] = useState("2");
  const [result, setResult] = useState<{ key: string; benchmark: RentalBenchmark | null; failed?: boolean } | null>(null);
  const key = useMemo(() => JSON.stringify([bedrooms, catalog?.sources.map(s => s.id)]), [bedrooms, catalog]);
  useEffect(() => {
    if (!catalog) return;
    const abort = new AbortController();
    loadRentalBenchmark(catalog, bedrooms, abort.signal)
      .then(benchmark => { if (!abort.signal.aborted) setResult({ key, benchmark }); })
      .catch(() => { if (!abort.signal.aborted) setResult({ key, benchmark: null, failed: true }); });
    return () => abort.abort();
  }, [catalog, bedrooms, key]);
  const current = result?.key === key ? result : null;
  const benchmark = current?.benchmark;
  return <section className={styles.panelSection} aria-labelledby="rental-market-title">
    <h2 id="rental-market-title">Regional rent by bedroom</h2>
    <label htmlFor="rental-bedrooms">Apartment size </label>
    <select id="rental-bedrooms" value={bedrooms} onChange={e => setBedrooms(e.target.value)}>
      <option value="studio">Studio</option><option value="1">1 bedroom</option>
      <option value="2">2 bedrooms</option><option value="3plus">3+ bedrooms</option>
    </select>
    <div aria-live="polite">{!catalog ? <p>Rental catalogue unavailable.</p>
      : !current ? <p>Loading CMHC rental context…</p>
      : benchmark ? <>
        <dl className={styles.measurements}><div><dt>Toronto CMA average rent</dt>
          <dd>{new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(benchmark.value)}<small>/ month · October {benchmark.year}</small></dd>
        </div></dl>
        <p className={styles.caption}>Regional context for all neighbourhood selections. CMHC’s Toronto CMA covers a larger area than the City of Toronto. The survey covers private apartment rental structures and includes occupied and vacant units; utilities vary.</p>
        <a href={benchmark.source.url} target="_blank" rel="noreferrer">CMHC source workbook ↗</a>
        {benchmark.notes && <p className={styles.caption}>{benchmark.notes}</p>}
      </> : <p>{current.failed ? "Rental context could not be loaded. Try again later." : "No unique published CMHC value is loaded for this bedroom size."}</p>}</div>
  </section>;
}
