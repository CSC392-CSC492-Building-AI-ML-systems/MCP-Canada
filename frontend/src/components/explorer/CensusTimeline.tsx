"use client";
import styles from "./explorer.module.css";

export function CensusTimeline({ years, year, onYearChange }: {
  years: number[]; year: number; onYearChange: (year: number) => void;
}) {
  const index = Math.max(0, years.indexOf(year));
  return <section className={styles.timeline} aria-label="Census timeline">
    <div className={styles.timelineHeading}><div><span className={styles.kicker}>THE CENSUS TIME LENS</span><h2>One place. Different periods.</h2></div><span className={styles.yearPill}>{year}</span></div>
    <div className={styles.timelineControls}>
      <button type="button" aria-label="Previous Census year" disabled={index === 0} onClick={() => onYearChange(years[index - 1])}>←</button>
      <div className={styles.yearTrack} role="group" aria-label="Choose a Census year">
        {years.map(y => <button type="button" key={y} aria-pressed={y === year} onClick={() => onYearChange(y)} className={y === year ? styles.activeYear : ""}><span aria-hidden="true" />{y}</button>)}
      </div>
      <button type="button" aria-label="Next Census year" disabled={index >= years.length - 1} onClick={() => onYearChange(years[index + 1])}>→</button>
    </div>
    <p>Available Census periods on the selected boundary set. Gaps stay unavailable.</p>
  </section>;
}
