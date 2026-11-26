"use client";
import { useEffect, useRef, useState } from "react";
import { applyDollarBasis, basisNote, censusReferenceYear, dollarBasisOptions, loadAnnualCpi, NOMINAL_BASIS, NOMINAL_NOTE, type CensusMeasure, type CpiTable, type DisplayValue } from "@/lib/inflation";
import { formatPercent, measuredChange } from "./change";
import { measuredNumber, money } from "./NeighbourhoodDetailsPanel";
import type { Measurement, NeighbourhoodProfile, ProfileMetrics } from "./types";
import styles from "./explorer.module.css";

// `measure` marks dollar rows, which can be shown adjusted for inflation.
type Row = { key: keyof ProfileMetrics; label: string; format: (n: number) => string; measure?: CensusMeasure };
const ROWS: Row[] = [
  { key: "cost", label: "Average renter shelter cost / mo.", format: money, measure: "shelter_cost" },
  { key: "income", label: "Average household income / yr", format: money, measure: "income" },
  { key: "population", label: "Population", format: n => n.toLocaleString("en-CA") },
];
const combined = (m?: Measurement) => m?.derived?.relation === "combined";

/** `cpi` is the annual CPI table; when it is not given the panel loads it. Dollars start
 * as published unless `dollarBasis` names another choice, such as "2021". */
export function AcrossTimePanel({ profile, onCompare, saved, limitReached, onAskTeacher, cpi, dollarBasis = NOMINAL_BASIS }: {
  profile: NeighbourhoodProfile; onCompare: () => void; saved: boolean; limitReached: boolean; onAskTeacher?: () => void; cpi?: CpiTable; dollarBasis?: string;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [loadedCpi, setLoadedCpi] = useState<CpiTable | null>(null);
  const [basisId, setBasisId] = useState(dollarBasis);
  // Without CPI the toggle is left out and dollars stay as published.
  useEffect(() => { if (!cpi) loadAnnualCpi().then(setLoadedCpi).catch(() => {}); }, [cpi]);
  const table = cpi ?? loadedCpi;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [profile.geography.id]);
  const years = profile.available_years;
  const defaults = years.length <= 3 ? years : [years[0], years[Math.floor((years.length - 1) / 2)], years[years.length - 1]];
  const periods = defaults.map((year, i) => years.includes(chosen[i]) ? chosen[i] : year);
  const at = (year: number) => profile.history.find(item => item.year === year);
  const [first, last] = [Math.min(...periods), Math.max(...periods)];
  // "As published", or the dollars of the latest available Census year when it has CPI.
  const options = table ? dollarBasisOptions(table, [Math.max(...years)]) : [];
  const basis = options.find(o => o.id === basisId) ?? options[0];
  /** The number to show for a row and Census year. Dollars are converted from the year they
   * describe (income is the year before the Census); a value that cannot be converted is shown
   * as published with `note` saying why, never guessed. */
  const shown = (row: Row, year: number): { n: number | null; dollars?: DisplayValue } => {
    const m = at(year)?.[row.key]; const n = m ? measuredNumber(m) : null;
    if (!row.measure || !table || !basis) return { n };
    const dollars = applyDollarBasis([{ year: m?.reference_year ?? censusReferenceYear(year, row.measure), value: n }], basis, table)[0];
    return { n: dollars.shown, dollars };
  };
  const dollarValues = periods.flatMap(y => ROWS.flatMap(r => shown(r, y).dollars ?? []));
  const dollarNote = dollarValues.length ? basisNote(dollarValues) : NOMINAL_NOTE;
  const derivedNotes = [...new Set(periods.flatMap(y => ROWS.map(r => at(y)?.[r.key]).filter(combined).map(m => m!.derived!.method)))];
  const sources = [...new Map(periods.flatMap(y => ROWS.flatMap(r => { const m = at(y)?.[r.key]; return m?.source ? [[`${y}|${m.source.id}`, { year: y, m }] as const] : []; }))).values()];
  return <aside className={styles.detailsPanel} aria-labelledby="across-time-title">
    <div className={styles.panelScroll} ref={scroll}>
      <p className={styles.kicker}>ONE PLACE · MULTIPLE PERIODS</p><h1 id="across-time-title" className={styles.acrossHeading}>Compare across time</h1>
      <section className={styles.contextCard}><p className={styles.kicker}>SELECTED PLACE</p><h2>{profile.geography.name}</h2><p className={styles.caption}>The same neighbourhood boundary is used for every period.</p></section>
      {profile.boundary_note && <section className={styles.missingNotice}><h2>BOUNDARY CHANGED IN 2021</h2><p>{profile.boundary_note}</p></section>}
      <div className={styles.periodChoices}>{periods.map((year, i) => <label key={i}><span className={styles.visuallyHidden}>Comparison period {i + 1}</span><select value={year} onChange={event => setChosen(periods.map((y, n) => n === i ? Number(event.target.value) : y))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>)}</div>
      {years.length < 2 && <section className={styles.missingNotice}><h2>ONE PERIOD ONLY</h2><p>Only one Census period is available for this area on these boundaries, so there is nothing to compare it with.</p></section>}
      {options.length > 1 && <div className={styles.dollarBasis} role="group" aria-label="Show dollars">
        <span>Dollars</span>{options.map(o => <button type="button" key={o.id} aria-pressed={o.id === basis?.id} onClick={() => setBasisId(o.id)}>{o.label}</button>)}
      </div>}
      <table className={styles.acrossTable}><caption className={styles.visuallyHidden}>Census measurements for the same neighbourhood across selected periods</caption>
        <thead><tr><th>Metric</th>{periods.map((y, i) => <th key={i}>{y}</th>)}</tr></thead>
        <tbody>{ROWS.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{periods.map((y, i) => {
          const m = at(y)?.[row.key]; const { n, dollars } = shown(row, y);
          return <td key={i} title={n === null ? m?.reason || "Unavailable" : dollars?.note ?? m?.derived?.method}>{n === null ? "—" : row.format(n)}{combined(m) && <sup aria-label="combined from 2021 neighbourhoods">*</sup>}</td>;
        })}</tr>)}
          <tr><th scope="row">Income year</th>{periods.map((y, i) => <td key={i}>{at(y)?.income.reference_year ?? "—"}</td>)}</tr>
        </tbody></table>
      <p className={styles.caption}>{dollarNote}</p>
      {derivedNotes.length > 0 && <p className={styles.caption}>* {derivedNotes.join(" ")}</p>}
      {periods.length > 1 && first !== last && <section className={styles.explanation} aria-labelledby="change-title"><h2 id="change-title">What changed, {first}–{last}</h2>
        <ul className={styles.changeList}>{ROWS.map(row => {
          const from = shown(row, first), to = shown(row, last);
          // Never compare an adjusted value with one that could not be adjusted.
          const unadjusted = [from, to].find(v => v.dollars?.note);
          if (unadjusted) return <li key={row.key}><strong>{row.label}:</strong> not comparable — the {unadjusted === from ? first : last} value could not be adjusted for inflation.</li>;
          const change = measuredChange(from.n, to.n);
          if (!change) return <li key={row.key}><strong>{row.label}:</strong> not comparable — the {from.n !== null ? last : first} value is unavailable.</li>;
          const sign = change.absolute > 0 ? "+" : change.absolute < 0 ? "−" : "";
          return <li key={row.key}><strong>{row.label}:</strong> {row.format(change.from)} → {row.format(change.to)} ({sign}{row.format(Math.abs(change.absolute))}{change.percent !== null && `, ${formatPercent(change.percent)}`}){change.major && <span className={styles.majorChange}>Major change</span>}</li>;
        })}</ul>
        <p className={styles.caption}>Measured change only; the data does not show what caused it. Changes of 15% or more are marked as major.</p>
      </section>}
      <section className={styles.explanation}><h2>Reading the table</h2><p>A dash means unavailable, never zero. Renter shelter cost is the same average in every year (called gross rent in 2001 and 2006); the 2016 neighbourhood profile does not publish it. Income is for the year before each Census.</p>{profile.method.population && <p className={styles.caption}>{profile.method.population}</p>}</section>
      <h2>Historical context by period</h2>{periods.map((year, i) => <section className={styles.contextCard} key={i}><h2>{year} · investigate</h2><p>How did housing costs and the surrounding community change during this period?</p><p className={styles.caption}>No verified historical accounts linked.</p></section>)}
      <section className={styles.panelSection}><h2>Sources &amp; comparison method</h2><p className={styles.caption}>{profile.method.comparison}</p>{sources.map(({ year, m }) => <div className={styles.sourceItem} key={`${year}|${m.source!.id}`}><a href={m.source!.url} target="_blank" rel="noreferrer">{year} · {m.source!.title} ↗</a><p>{m.source!.publisher}</p></div>)}</section>
    </div>
    <footer className={styles.panelActions}><button type="button" className={styles.primaryButton} disabled={saved || limitReached} onClick={onCompare}>{saved ? "Added to compare ✓" : limitReached ? "5 places saved" : "Add to compare"}</button><button type="button" className={styles.secondaryButton} onClick={onAskTeacher} disabled={!onAskTeacher}>Ask the AI teacher</button></footer>
  </aside>;
}
