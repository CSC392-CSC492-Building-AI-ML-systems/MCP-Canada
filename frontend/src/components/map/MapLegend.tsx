"use client";
import { useState, type ReactNode } from "react";
import styles from "./HousingMap.module.css";

/** `source`: shown as the section's tooltip, so it stays reachable when the map is too short to print it. */
export type LegendSection = { id: string; title: string; content: ReactNode; source?: string };

/** A banded colour key that also says where the selected neighbourhood falls: its value
 * on its own line and its band marked, so the reader needn't match colours by eye. */
export function BandKey({ labels, colors, noData, noDataLabel, selected }: {
  labels: string[]; colors: string[]; noData: string; noDataLabel: string;
  /** The selected neighbourhood: its name, its value as text, and its band (null when unknown). */
  selected?: { name: string; text: string; band: number | null } | null;
}) {
  return <>
    {selected && <p className={styles.legendSelected}><strong>{selected.name}</strong> · {selected.text}</p>}
    <ul className={styles.bandList}>
      {labels.map((label, i) => <li key={label} className={selected?.band === i ? styles.legendCurrent : undefined}>
        <span style={{ background: colors[i] }} />{label}{selected?.band === i && <em> ◂ {selected.name}</em>}</li>)}
      <li className={selected && selected.band === null ? styles.legendCurrent : undefined}><span style={{ background: noData }} />{noDataLabel}</li>
    </ul>
  </>;
}

/** One legend in the map's corner for every active layer, which the viewer can collapse. */
export function MapLegend({ sections }: { sections: LegendSection[] }) {
  const [open, setOpen] = useState(true);
  if (!sections.length) return null;
  return <section className={`${styles.legend} ${open ? "" : styles.legendClosed}`} aria-label="Map legend">
    <button type="button" className={styles.legendToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      {open ? "Hide legend" : `Legend (${sections.length})`}<span aria-hidden="true">{open ? "▾" : "▸"}</span>
    </button>
    {open && <div className={styles.legendBody} aria-live="polite">
      {sections.map((s) => <div key={s.id} className={styles.legendSection} title={s.source}><h2>{s.title}</h2>{s.content}</div>)}
    </div>}
  </section>;
}
