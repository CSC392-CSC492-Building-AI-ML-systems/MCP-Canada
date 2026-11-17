"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { comparisonYears, loadComparisonProfile, loadWorkspaceData, type Catalog } from "@/components/explorer/data";
import type { BoundarySet, NeighbourhoodProfile } from "@/components/explorer/types";
import { ComparisonTable } from "@/components/workflow/ComparisonTable";
import { emptyExtras, loadComparisonExtras, type ComparisonExtras } from "@/components/workflow/comparison-extras";
import { WorkflowHeader } from "@/components/workflow/WorkflowHeader";
import { TeacherPanel, useTeacher } from "@/components/workflow/Teacher";
import { PROFILE_KEY, RECOMMENDED_KEY, readSavedRaw, comparisonHref, parsePlaces, parseProfile, readSession, subscribeSession } from "@/components/workflow/state";
import styles from "@/components/workflow/workflow.module.css";

/** Licence attribution required by the open data shown on this page (OSM data is ODbL). */
function DataAttribution({ sourceIds }: { sourceIds: string[] }) {
  const has = (prefix: string) => sourceIds.some(id => id.startsWith(prefix));
  const notes = [
    has("osm-groceries-") && <>Grocery locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, available under the Open Database License.</>,
    has("crime-rates-") && <>Contains information licensed under the <a href="https://www.ontario.ca/page/open-government-licence-ontario" target="_blank" rel="noreferrer">Open Government Licence – Ontario</a> (Toronto Police Service).</>,
    has("toronto-green-spaces-") && <>Green spaces: contains information licensed under the <a href="https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/" target="_blank" rel="noreferrer">Open Government Licence – Toronto</a>.</>,
  ].filter(Boolean);
  return notes.length ? <p>{notes.map((note, i) => <span key={i}>{note} </span>)}</p> : null;
}

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
  const years = set ? comparisonYears(sets) : [];
  const year = chosenYear && years.includes(chosenYear) ? chosenYear : set?.years.at(-1);
  const key = `${ids.join(",")}:${year}`;
  const profiles = result?.key === key ? result.profiles : null;
  const [extrasResult, setExtrasResult] = useState<{ key: string; extras: ComparisonExtras | null } | null>(null);
  const extrasKey = `${key}:${preferences?.bedrooms ?? ""}`;
  const extras = extrasResult?.key === extrasKey ? extrasResult.extras : null;
  useEffect(() => {
    if (!catalog || !profiles || !year) return;
    const abort = new AbortController();
    // Extra rows are supplementary: if they fail, the Census table still shows.
    loadComparisonExtras(catalog, profiles, year, preferences, abort.signal)
      .then(extras => setExtrasResult({ key: extrasKey, extras }))
      .catch(() => { if (!abort.signal.aborted) setExtrasResult({ key: extrasKey, extras: emptyExtras }); });
    return () => abort.abort();
  }, [catalog, profiles, year, preferences, extrasKey]);
  useEffect(() => {
    if (!catalog || !set || !year || selected.length < 2) return;
    const abort = new AbortController();
    Promise.all(selected.map(place => loadComparisonProfile(catalog, place.id, year, abort.signal)))
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
      <div className={styles.periodRow}><label>PERIOD FOR ALL LOCATIONS<select aria-label="Shared Census year" value={year ?? ""} disabled={!set} onChange={event => { const value = Number(event.target.value); setChosenYear(value); const url = new URL(window.location.href); url.searchParams.set("year", String(value)); window.history.replaceState(null, "", url); }}>{!set && <option value="">Choose places from one boundary set</option>}{years.map(y => <option key={y} value={y}>{y} Census</option>)}</select></label><div><p className={styles.kicker}>YOUR PROFILE · SAME ASSUMPTIONS FOR EVERY PLACE</p><p>{preferences ? `${preferences.bedrooms === "0" ? "Studio" : `${preferences.bedrooms} bedrooms`} · $${Number(preferences.rent).toLocaleString("en-CA")} budget · ${preferences.mode} · ${preferences.trip} min preferred trip` : "No profile entered. Published Census measurements remain available."}</p><Link href="/housing/profile/">{preferences ? "Edit your profile →" : "Complete your profile →"}</Link></div></div>
      <div className={styles.selectionTools}><div className={styles.selectedChips}>{selected.map(place => <button type="button" key={place.id} onClick={() => changePlaces(ids.filter(id => id !== place.id))} aria-label={`Remove ${place.name} from comparison`}>{place.name} ×</button>)}</div><label>Add a place<select aria-label="Add a place to comparison" value={addId} disabled={ids.length >= 5} onChange={event => setAddId(event.target.value)}><option value="">Choose a neighbourhood</option>{catalog?.geographies.filter(g => !ids.includes(g.id) && sets.some(s => s.id === g.geography_set_id) && (!set || g.geography_set_id === set.id)).map(g => <option key={g.id} value={g.id}>{g.name} · {g.geography_set_id === "toronto-140" ? "140" : "158"}</option>)}</select></label><button type="button" className={styles.secondary} disabled={!addId || ids.length >= 5} onClick={() => { changePlaces([...ids, addId]); setAddId(""); }}>Add</button></div>
      {boundaries.length > 1 ? <section className={styles.notice} role="status"><h2>Choose one boundary set</h2><p>Historical 140 and Current 158 represent different areas. Remove places from one set before comparing.</p></section> : selected.length < 2 ? <section className={styles.empty}><h2>Add at least two places</h2><p>Save up to five neighbourhoods on the map, or choose them above.</p><Link className={styles.primary} href="/housing/saved/">Browse saved places →</Link></section> : !profiles && !error ? <p role="status">Loading shared-period measurements…</p> : profiles && <>
        <p className={styles.caption}>Green marks the lowest available shelter cost. A dash means unavailable, never zero.{profiles.some(p => p.data_geography) && ` ${year} values come from the ${profiles[0].data_geography?.boundary_set === "toronto-140" ? "Historical 140" : "Current 158"} boundaries for neighbourhoods whose area is unchanged.`}</p><ComparisonTable profiles={profiles} preferences={preferences} extras={extras} />
        <h2>Where could you explore?</h2><section className={styles.evidenceCard}><h3>Read the tradeoffs</h3><p>Compare published shelter costs with your budget, then investigate the factors marked unavailable. These Census benchmarks do not describe current listings or bedroom-specific rent.</p><Link className={styles.primary} href="/housing/profile/">Update your profile →</Link></section>
        <div className={styles.contextGrid}>{profiles.map(p => <section key={p.geography.id}><h3>{p.geography.name}</h3><p>How did housing and transport shape everyday life here?</p><Link href={`/housing/across-time/?neighbourhood=${encodeURIComponent(p.data_geography?.id ?? p.geography.id)}&year=${p.year}`}>Compare this location across time →</Link><small>No verified historical accounts linked.</small></section>)}</div>
        <section className={styles.evidenceCard}><h2>Sources &amp; method</h2><p>Same neighbourhood boundary set and Census year. Income may refer to the previous calendar year. Your entered budget and income are personal illustrations and may refer to a different period. Values are nominal.</p><p>Partial match score: affordability is 100 at or below 75% of your rent budget, 50 at your budget and 0 at 125% or more (Census shelter cost, nominal); nearby amenities averages how each place list within 1 km of the boundary (libraries, schools, supermarkets and grocers, transit stops) ranks against every neighbourhood in the same boundary set, by places per km² of that area so large neighbourhoods are not favoured for their size (ties share a rank; a list without data is left out); safety is the share of Toronto&apos;s 158 neighbourhoods with more reported major crime per 100,000 residents in that year; lifestyle averages your chosen priorities that have data (transit access from the transit-stop rank, walkable errands from the grocer and library ranks, school access from the school rank, family-friendly from the school rank and the share of children, which scores 100 at 20% or more, parks and green space from the park-density and green-space-share ranks), so those lists can count towards both amenities and lifestyle. Parks are City parks and open green spaces; green-space share also includes ravines, hydro corridors and cemeteries but not golf courses, building grounds or road islands. Restaurants and nightlife, quiet streets and cultural community are not scored yet. Place lists are current snapshots, not historical, and crime counts only incidents reported to police. Factors without data are left out, never scored as zero. Toronto average rent is CMHC&apos;s October survey for the whole Toronto area, available only where a survey year matches the Census year.</p><DataAttribution sourceIds={(extras?.sources ?? []).map(s => s.id)} />{[...new Map([...profiles.flatMap(p => Object.values(p.metrics).flatMap(m => m.source ? [[m.source.id, m.source] as const] : [])), ...(extras?.sources ?? []).map(s => [s.id, s] as const)]).values()].map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.publisher} ↗</a>)}</section>
      </>}
    </>}
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => router.push(from === "recommended" ? "/housing/recommended/" : "/housing/saved/")}>← Back to map</button><Link href="/housing/profile/" className={styles.secondary}>Complete your profile</Link></div>
  </main><TeacherPanel /></div></div>;
}
