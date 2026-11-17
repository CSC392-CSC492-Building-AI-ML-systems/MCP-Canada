"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { loadProfile, loadWorkspaceData, type Catalog } from "@/components/explorer/data";
import type { BoundarySet, NeighbourhoodProfile } from "@/components/explorer/types";
import { ComparisonTable } from "@/components/workflow/ComparisonTable";
import { WorkflowHeader } from "@/components/workflow/WorkflowHeader";
import { TeacherPanel, useTeacher } from "@/components/workflow/Teacher";
import { PROFILE_KEY, RECOMMENDED_KEY, readSavedRaw, comparisonHref, parsePlaces, parseProfile, readSession, subscribeSession } from "@/components/workflow/state";
import styles from "@/components/workflow/workflow.module.css";

export default function ComparePage() {
  const router = useRouter();
  const { setContext } = useTeacher();
  const rawProfile = useSyncExternalStore(subscribeSession, () => readSession(PROFILE_KEY), () => null);
  const preferences = useMemo(() => parseProfile(rawProfile), [rawProfile]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sets, setSets] = useState<BoundarySet[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [from, setFrom] = useState<"saved" | "recommended">("saved");
  const [chosenYear, setChosenYear] = useState<number | null>(null);
  const [addId, setAddId] = useState("");
  const [result, setResult] = useState<{ key: string; profiles: NeighbourhoodProfile[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    loadWorkspaceData(abort.signal).then(data => {
      setCatalog(data.catalog); setSets(data.boundary_sets);
      const params = new URLSearchParams(window.location.search);
      const origin = params.get("from") === "recommended" ? "recommended" : "saved";
      setFrom(origin);
      let stored: string | null = null;
      try { stored = origin === "recommended" ? readSession(RECOMMENDED_KEY) : readSavedRaw(); } catch { /* Empty state remains usable. */ }
      const requested = params.has("places") ? (params.get("places") ?? "").split(",") : parsePlaces(stored).map(p => p.id);
      setIds([...new Set(requested)].filter(id => data.catalog.geographies.some(g => g.id === id)).slice(0, 5));
      setChosenYear(Number(params.get("year")) || null); setError("");
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [retry]);
  const selected = useMemo(() => ids.map(id => catalog?.geographies.find(g => g.id === id)).filter(g => !!g), [ids, catalog]);
  const boundaries = [...new Set(selected.map(g => g.geography_set_id))];
  const set = boundaries.length === 1 ? sets.find(s => s.id === boundaries[0]) : null;
  const year = chosenYear && set?.years.includes(chosenYear) ? chosenYear : set?.years.at(-1);
  const key = `${ids.join(",")}:${year}`;
  const profiles = result?.key === key ? result.profiles : null;
  useEffect(() => {
    if (!catalog || !set || !year || selected.length < 2) return;
    const abort = new AbortController();
    Promise.all(selected.map(place => loadProfile(catalog, place.id, year, abort.signal)))
      .then(profiles => { setResult({ key, profiles }); setError(""); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [catalog, set, year, selected, key]);
  useEffect(() => {
    setContext(profiles ? { profiles, title: `Comparison · ${year} Census` } : null);
    return () => setContext(null);
  }, [profiles, year, setContext]);
  function changePlaces(next: string[]) {
    setIds(next);
    const places = next.flatMap(id => { const g = catalog?.geographies.find(g => g.id === id); return g ? [{ id, name: g.name, boundary: g.geography_set_id, year: year ?? 2021 }] : []; });
    const href = comparisonHref(places, from);
    window.history.replaceState(null, "", `${href}${year ? `&year=${year}` : ""}`);
  }
  return <div className={styles.page}><WorkflowHeader compare /><div className={styles.comparisonLayout}><main className={styles.comparisonMain}>
    <p className={styles.kicker}>COMPARE PLACES · ONE SHARED PERIOD</p><h1>Side-by-side comparison</h1><p className={styles.intro}>Different neighbourhoods, the same time period. Compare housing, everyday needs and local context.</p>
    {error && <div className={styles.notice} role="alert"><p>{error}</p><button className={styles.secondary} onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
    {!catalog && !error ? <p role="status">Loading comparison data…</p> : <>
      <div className={styles.periodRow}><label>PERIOD FOR ALL LOCATIONS<select aria-label="Shared Census year" value={year ?? ""} disabled={!set} onChange={event => { const value = Number(event.target.value); setChosenYear(value); const url = new URL(window.location.href); url.searchParams.set("year", String(value)); window.history.replaceState(null, "", url); }}>{!set && <option value="">Choose places from one boundary set</option>}{set?.years.map(y => <option key={y}>{y}</option>)}</select></label><div><p className={styles.kicker}>YOUR PROFILE · SAME ASSUMPTIONS FOR EVERY PLACE</p><p>{preferences ? `${preferences.bedrooms === "0" ? "Studio" : `${preferences.bedrooms} bedrooms`} · $${Number(preferences.rent).toLocaleString("en-CA")} budget · ${preferences.mode} · ${preferences.trip} min preferred trip` : "No profile entered. Published Census measurements remain available."}</p><Link href="/housing/profile/">{preferences ? "Edit your profile →" : "Complete your profile →"}</Link></div></div>
      <div className={styles.selectionTools}><div className={styles.selectedChips}>{selected.map(place => <button type="button" key={place.id} onClick={() => changePlaces(ids.filter(id => id !== place.id))} aria-label={`Remove ${place.name} from comparison`}>{place.name} ×</button>)}</div><label>Add a place<select aria-label="Add a place to comparison" value={addId} disabled={ids.length >= 5} onChange={event => setAddId(event.target.value)}><option value="">Choose a neighbourhood</option>{catalog?.geographies.filter(g => !ids.includes(g.id) && sets.some(s => s.id === g.geography_set_id) && (!set || g.geography_set_id === set.id)).map(g => <option key={g.id} value={g.id}>{g.name} · {g.geography_set_id === "toronto-140" ? "140" : "158"}</option>)}</select></label><button type="button" className={styles.secondary} disabled={!addId || ids.length >= 5} onClick={() => { changePlaces([...ids, addId]); setAddId(""); }}>Add</button></div>
      {boundaries.length > 1 ? <section className={styles.notice} role="status"><h2>Choose one boundary set</h2><p>Historical 140 and Current 158 represent different areas. Remove places from one set before comparing.</p></section> : selected.length < 2 ? <section className={styles.empty}><h2>Add at least two places</h2><p>Save up to five neighbourhoods on the map, or choose them above.</p><Link className={styles.primary} href="/housing/saved/">Browse saved places →</Link></section> : !profiles && !error ? <p role="status">Loading shared-period measurements…</p> : profiles && <>
        <p className={styles.caption}>Green marks the lowest available shelter cost. A dash means unavailable, never zero.</p><ComparisonTable profiles={profiles} preferences={preferences} />
        <h2>Where could you explore?</h2><section className={styles.evidenceCard}><h3>Read the tradeoffs</h3><p>Compare published shelter costs with your budget, then investigate the factors marked unavailable. These Census benchmarks do not describe current listings or bedroom-specific rent.</p><Link className={styles.primary} href="/housing/profile/">Update your profile →</Link></section>
        <div className={styles.contextGrid}>{profiles.map(p => <section key={p.geography.id}><h3>{p.geography.name}</h3><p>How did housing and transport shape everyday life here?</p><Link href={`/housing/across-time/?neighbourhood=${encodeURIComponent(p.geography.id)}&year=${p.year}`}>Compare this location across time →</Link><small>No verified historical accounts linked.</small></section>)}</div>
        <section className={styles.evidenceCard}><h2>Sources &amp; method</h2><p>Same neighbourhood boundary set and Census year. Income may refer to the previous calendar year. Your entered budget and income are personal illustrations and may refer to a different period. Values are nominal.</p>{[...new Map(profiles.flatMap(p => Object.values(p.metrics).flatMap(m => m.source ? [[m.source.id, m.source] as const] : []))).values()].map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.publisher} ↗</a>)}</section>
      </>}
    </>}
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => router.push(from === "recommended" ? "/housing/recommended/" : "/housing/saved/")}>← Back to map</button><Link href="/housing/profile/" className={styles.secondary}>Complete your profile</Link></div>
  </main><TeacherPanel /></div></div>;
}
