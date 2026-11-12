"use client";
import type { CSSProperties, ReactNode } from "react";
import styles from "./explorer.module.css";

/** Time scrubber. Only Census years loaded for the active boundary set appear;
 * gaps between them are never filled. `controls` sits in the heading. */
export function CensusTimeline({ years, year, onYearChange, controls }: {
  years: number[]; year: number | null; onYearChange: (year: number) => void; controls?: ReactNode;
}) {
  const index = Math.max(0, years.indexOf(year ?? -1));
  // --p is 0 at the first year and 1 at the last; CSS maps it onto the track.
  const at = (i: number) => ({ "--p": years.length > 1 ? i / (years.length - 1) : 1 }) as CSSProperties;
  return <section className={styles.timeline} aria-labelledby="timeline-title">
    <div className={styles.timelineHeading}>
      <h2 id="timeline-title" className={styles.timelineLabel}>TIME</h2>
      {controls}
      <span className={styles.timelineStatus} aria-live="polite">{years.length ? `${year} Census` : "Census data not loaded"}</span>
    </div>
    <div className={styles.scrubber} style={at(index)}>
      <div className={styles.timelineTrack} aria-hidden="true"><span style={!years.length ? { width: 0 } : undefined} /></div>
      {years.length > 0 && <input className={styles.timelineSlider} type="range" min={0} max={Math.max(0, years.length - 1)} step={1} value={index}
        disabled={years.length < 2} aria-label="Census year" aria-valuetext={`${year} Census`}
        onChange={event => onYearChange(years[Number(event.target.value)])} />}
    </div>
    {!years.length && <p className={styles.timelineEmpty}>Available Census years will appear here once neighbourhood data is loaded. The map shows the present day.</p>}
    <div className={styles.timelineYears} role="group" aria-label="Choose a Census year">
      {years.map((y, i) => <button type="button" key={y} aria-pressed={y === year} onClick={() => onYearChange(y)} style={at(i)}>{y}</button>)}
    </div>
  </section>;
}
