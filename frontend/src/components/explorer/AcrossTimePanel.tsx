"use client";
import { useEffect, useRef, useState } from "react";
import { measuredNumber, money } from "./NeighbourhoodDetailsPanel";
import type { NeighbourhoodProfile } from "./types";
import styles from "./explorer.module.css";

export function AcrossTimePanel({ profile, onCompare, saved, limitReached, onAskTeacher }: {
  profile: NeighbourhoodProfile; onCompare: () => void; saved: boolean; limitReached: boolean; onAskTeacher?: () => void;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [profile.geography.id]);
  const years = profile.available_years;
  const defaults = years.length <= 3 ? years : [years[0], years[Math.floor((years.length - 1) / 2)], years[years.length - 1]];
  const periods = defaults.map((year, i) => years.includes(chosen[i]) ? chosen[i] : year);
  const costs = periods.map(year => profile.history.find(item => item.year === year)?.cost);
  return <aside className={styles.detailsPanel} aria-labelledby="across-time-title">
    <div className={styles.panelScroll} ref={scroll}>
      <p className={styles.kicker}>ONE PLACE · MULTIPLE PERIODS</p><h1 id="across-time-title" className={styles.acrossHeading}>Compare across time</h1>
      <section className={styles.contextCard}><p className={styles.kicker}>SELECTED PLACE</p><h2>{profile.geography.name}</h2><p className={styles.caption}>Keep the same location and boundary for every period.</p></section>
      <div className={styles.periodChoices}>{periods.map((year, i) => <label key={i}><span className={styles.visuallyHidden}>Comparison period {i + 1}</span><select value={year} onChange={event => setChosen(periods.map((y, n) => n === i ? Number(event.target.value) : y))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>)}</div>
      <h2>What changed here?</h2>
      <section className={styles.missingNotice}><h2>PUBLISHED CENSUS DATA</h2><p>{years.length < 2 ? "Only one Census period is loaded for this boundary set. Choose Historical 140 in the timeline to explore earlier years on those boundaries." : "Compare the loaded source values below. Earlier average gross rent and later median shelter costs have different definitions; no change percentage is inferred."}</p></section>
      <table className={styles.acrossTable}><caption className={styles.visuallyHidden}>Housing measurements for the same neighbourhood across selected Census periods</caption><thead><tr><th>Metric</th>{periods.map((y, i) => <th key={i}>{y}</th>)}</tr></thead><tbody><tr><th scope="row">Renter shelter / mo.</th>{costs.map((m, i) => { const n = m && measuredNumber(m); return <td key={i}>{n == null ? "—" : money(n)}</td>; })}</tr><tr><th scope="row">Statistic</th>{costs.map((m, i) => <td key={i}>{m?.statistic ?? "—"}</td>)}</tr><tr><th scope="row">Reference year</th>{costs.map((m, i) => <td key={i}>{m?.reference_year ?? "—"}</td>)}</tr></tbody></table>
      <section className={styles.explanation}><h2>Reading the change</h2><p>The table retains the same neighbourhood boundary across periods. A dash means unavailable, never zero. Dollar values are nominal and are not adjusted for inflation.</p></section>
      <h2>Historical context by period</h2>{periods.map((year, i) => <section className={styles.contextCard} key={i}><h2>{year} · investigate</h2><p>How did housing costs and the surrounding community change during this period?</p><p className={styles.caption}>No verified historical accounts linked.</p></section>)}
      <section className={styles.panelSection}><h2>Sources &amp; comparison method</h2><p className={styles.caption}>{profile.method.comparison}</p>{costs.map((m, i) => m?.source && <div className={styles.sourceItem} key={i}><a href={m.source.url} target="_blank" rel="noreferrer">{periods[i]} · {m.source.title} ↗</a><p>{m.label}</p><p>{m.source.publisher} · Reference year {m.reference_year}</p></div>)}</section>
    </div>
    <footer className={styles.panelActions}><button type="button" className={styles.primaryButton} disabled={saved || limitReached} onClick={onCompare}>{saved ? "Added to compare ✓" : limitReached ? "5 places saved" : "Add to compare"}</button><button type="button" className={styles.secondaryButton} onClick={onAskTeacher} disabled={!onAskTeacher}>Ask the AI teacher</button></footer>
  </aside>;
}
