"use client";
import type { CSSProperties, ReactNode } from "react";
import styles from "./explorer.module.css";

/** Time scrubber. Only Census years loaded for the active boundary set appear;
 * gaps between them are never filled. `controls` sits in the heading. */
export function CensusTimeline({ years, year, onYearChange, controls }: {
  years: number[]; year: number; onYearChange: (year: number) => void; controls?: ReactNode;
}) {
  const index = Math.max(0, years.indexOf(year));
  // --p is 0 at the first year and 1 at the last; CSS maps it onto the track.
  const at = (i: number) => ({ "--p": years.length > 1 ? i / (years.length - 1) : 1 }) as CSSProperties;
  return <section className={styles.timeline} aria-labelledby="timeline-title">
    <div className={styles.timelineHeading}>
      <h2 id="timeline-title" className={styles.timelineLabel}>TIME</h2>
      {controls}
      <span className={styles.timelineStatus} aria-live="polite">{year} Census</span>
    </div>
    <div className={styles.timelineTrack} style={at(index)} aria-hidden="true"><span /></div>
    <div className={styles.timelineYears} role="group" aria-label="Choose a Census year">
      {years.map((y, i) => <button type="button" key={y} aria-pressed={y === year} onClick={() => onYearChange(y)} style={at(i)}>{y}</button>)}
    </div>
  </section>;
}
