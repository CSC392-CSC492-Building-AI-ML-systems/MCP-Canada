"use client";
import { useEffect, useState } from "react";
import { loadProfile, type Catalog } from "./data";
import { measuredNumber, money } from "./NeighbourhoodDetailsPanel";
import type { BoundarySet, NeighbourhoodProfile } from "./types";
import type { ExplorerPlace } from "./PlacesSidebar";
import styles from "./explorer.module.css";

export function PlaceComparison({ places, catalog, sets }: { places: ExplorerPlace[]; catalog: Catalog | null; sets: BoundarySet[] }) {
  const sameBoundary = places.length > 1 && places.every(place => place.boundary === places[0].boundary);
  const years = sameBoundary ? sets.find(set => set.id === places[0].boundary)?.years ?? [] : [];
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const year = chosenYear && years.includes(chosenYear) ? chosenYear : years.at(-1);
  const [result, setResult] = useState<{ key: string; profiles: NeighbourhoodProfile[] } | null>(null);
  const [error, setError] = useState("");
  const key = `${places.map(place => place.id).join(":")}:${year}`;
  useEffect(() => {
    if (!catalog || !sameBoundary || year === undefined) return;
    const abort = new AbortController();
    Promise.all(places.map(place => loadProfile(catalog, place.id, year, abort.signal)))
      .then(profiles => { setResult({ key, profiles }); setError(""); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [catalog, places, sameBoundary, year, key]);
  if (!sameBoundary) return <p>Choose at least two places from the same boundary set to compare one shared Census period. Historical 140 and Current 158 boundaries are kept separate.</p>;
  const profiles = result?.key === key ? result.profiles : null;
  return <div className={styles.comparisonContent}><label>Shared Census year <select value={year} onChange={event => setChosenYear(Number(event.target.value))}>{years.map(y => <option key={y}>{y}</option>)}</select></label>
    {error ? <p role="alert">{error}</p> : !profiles ? <p role="status">Loading comparison…</p> : <div className={styles.comparisonOverflow}><table className={styles.acrossTable}><thead><tr><th>Metric · {year}</th>{profiles.map(p => <th key={p.geography.id}>{p.geography.name}</th>)}</tr></thead><tbody>{([['cost', 'Shelter / month'], ['income', 'Household income / year'], ['burden', 'Housing burden']] as const).map(([metric, label]) => <tr key={metric}><th scope="row">{label}</th>{profiles.map(p => { const m = p.metrics[metric]; const n = measuredNumber(m); return <td key={p.geography.id}>{n === null ? "—" : m.unit?.startsWith("CAD") ? money(n) : m.unit === "percent" ? `${n}%` : n.toLocaleString("en-CA")}</td>; })}</tr>)}</tbody></table></div>}
    <p className={styles.caption}>Same boundary set and Census year. Dollar values are nominal. A dash means unavailable, never zero.</p>
  </div>;
}
