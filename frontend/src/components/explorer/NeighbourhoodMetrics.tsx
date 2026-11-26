import type { ComparisonExtras, PlaceExtras } from "../workflow/comparison-extras";
import type { Measurement } from "./types";
import styles from "./explorer.module.css";

const number = (value: number | null | undefined, suffix = "") =>
  value == null || !Number.isFinite(value) ? "Unavailable" : `${value.toLocaleString("en-CA", { maximumFractionDigits: 1 })}${suffix}`;

export function NeighbourhoodMetrics({ population, year, extras, loading, sources }: {
  population: Measurement; year: number; extras?: PlaceExtras; loading: boolean;
  sources: ComparisonExtras["sources"];
}) {
  const publishedPopulation = population.status === "observed" && population.value !== null
    ? Number(population.value) : null;
  const value = (n: number | null | undefined, suffix = "") => loading ? "Loading…" : number(n, suffix);
  return <>
    <section className={styles.panelSection} aria-labelledby="people-title">
      <h2 id="people-title">People &amp; households</h2>
      <p className={styles.caption}>{year} Census · selected data area</p>
      <dl className={styles.measurements}>
        <div><dt>Population</dt><dd>{number(publishedPopulation)}</dd></div>
        <div><dt>Children aged 0–14</dt><dd>{value(extras?.childrenPct, "%")}</dd></div>
        <div><dt>Residents aged 65+</dt><dd>{value(extras?.seniorsPct, "%")}</dd></div>
        <div><dt>Immigrant population share</dt><dd>{value(extras?.immigrantPct, "%")}</dd></div>
        <div><dt>Ground-oriented &amp; low-rise dwelling share</dt><dd>{value(extras?.lowRisePct, "%")}</dd></div>
      </dl>
      {population.source && <p className={styles.caption}>{population.source.publisher} · {population.source.title}</p>}
      <p className={styles.caption}>Age shares use the published age totals. Housing and immigrant shares are currently mapped for 2021 only. Population totals follow the Census coverage described under Sources and method.</p>
    </section>
    <section className={styles.panelSection} aria-labelledby="green-title">
      <h2 id="green-title">Green space</h2>
      <dl className={styles.measurements}>
        <div><dt>Parks inside or within 1 km of this neighbourhood</dt><dd>{value(extras?.parks)}</dd></div>
        <div><dt>Neighbourhood covered by green space</dt><dd>{value(extras?.greenSharePct, "%")}</dd></div>
      </dl>
      <p className={styles.caption}>Present-day City green-space snapshot. Parks are counted around the whole neighbourhood boundary; Everyday needs measures from the selected location.</p>
    </section>
    <section className={styles.panelSection} aria-labelledby="crime-title">
      <h2 id="crime-title">Reported crime</h2>
      {loading ? <p role="status">Loading published police rates…</p> : extras?.safety ? <>
        <p className={styles.caption}>{extras.safety.year} · Toronto Police · current 158-neighbourhood geography</p>
        <dl className={styles.measurements}>
          <div><dt>Combined major-crime rate</dt><dd>{number(extras.safety.rate)}<small>/ 100,000 residents</small></dd></div>
          <div><dt>Median neighbourhood rate</dt><dd>{number(extras.safety.cityMedian)}<small>/ 100,000 residents</small></dd></div>
        </dl>
        <p className={styles.caption}>Sum of published assault, auto theft, break and enter, robbery and theft-over rates. Rates describe police-reported incidents and use the source’s annual population estimates.</p>
      </> : <p>{extras?.safetyGap ?? "Police rates could not be loaded for this neighbourhood and year."}</p>}
    </section>
    {sources.length > 0 && <section className={styles.panelSection}>
      <h2>Neighbourhood metric sources</h2>
      {sources.map(source => <div className={styles.sourceItem} key={source.id}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
        <p>{source.publisher}</p>
      </div>)}
    </section>}
  </>;
}
