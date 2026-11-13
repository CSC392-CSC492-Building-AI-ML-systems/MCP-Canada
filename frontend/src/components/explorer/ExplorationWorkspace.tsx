"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comparisonHref, explorerHref, readProfile, parsePlaces, readSavedRaw, subscribeSaved, writeSaved } from "../workflow/state";
import { useTeacher } from "../workflow/Teacher";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AcrossTimePanel } from "./AcrossTimePanel";
import { PlacesSidebar, type ExplorerPlace, type SidebarMode } from "./PlacesSidebar";
import { CensusTimeline } from "./CensusTimeline";
import { NeighbourhoodDetailsPanel } from "./NeighbourhoodDetailsPanel";
import type { BoundarySet, ExplorationSelection, NeighbourhoodProfile } from "./types";
import styles from "./explorer.module.css";
import { loadWorkspaceData, loadProfile, type Catalog } from "./data";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import { findAtSameLocation, loadBoundaries } from "@/lib/boundaries";

const NO_RECOMMENDATIONS: ExplorerPlace[] = [];
const defaultNeighbourhoodId = (set: BoundarySet) => set.neighbourhoods.find(n => n.code === '1')?.id ?? set.neighbourhoods[0].id;
type SavedPlace = ExplorerPlace;
/** Shared selection is owned here. A teammate can mount the map with renderMap
 * and route map clicks through onSelectionChange; the panel and timeline sync. */
export function ExplorationWorkspace({ renderMap, recommendedPlaces = NO_RECOMMENDATIONS, initialSidebar = "collapsed", initialAcrossTime = false, recommendationNotice = "" }: {
  initialSidebar?: SidebarMode; initialAcrossTime?: boolean; recommendationNotice?: string;
  recommendedPlaces?: ExplorerPlace[];
  renderMap?: (selection: ExplorationSelection | null, onSelectionChange: (selection: ExplorationSelection) => void) => ReactNode;
}) {
  const router = useRouter();
  const { openTeacher, setContext } = useTeacher();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sets, setSets] = useState<BoundarySet[]>([]);
  const [selection, setSelection] = useState<ExplorationSelection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [sidebar, setSidebar] = useState<SidebarMode>(initialSidebar);
  const [acrossTime, setAcrossTime] = useState(initialAcrossTime);
  const [preview, setPreview] = useState<ExplorationSelection | null>(null);
  const viewSelection = preview ?? selection;
  const [result, setResult] = useState<{ key: string; profile: NeighbourhoodProfile } | null>(null);
  const [profileError, setProfileError] = useState<{ key: string; message: string } | null>(null);
  const [income, setIncome] = useState('');
  const [budget, setBudget] = useState('');
  const storedSaved = useSyncExternalStore(subscribeSaved, readSavedRaw, () => '[]');
  const saved = useMemo(() => parsePlaces(storedSaved), [storedSaved]);
  const [storageNotice, setStorageNotice] = useState('');
  const budgetAnchorHandled = useRef(false);
  const switchAbort = useRef<AbortController | null>(null);
  const selectionKey = viewSelection ? `${viewSelection.geographyId}:${viewSelection.year}` : '';
  const activeSet = sets.find(s => s.id === viewSelection?.boundarySetId);
  const selectedPlace = activeSet?.neighbourhoods.find(n => n.id === viewSelection?.geographyId);
  const profile = result?.key === selectionKey ? result.profile : null;
  const error = profileError?.key === selectionKey ? profileError.message : '';

  useEffect(() => {
    const abort = new AbortController();
    loadWorkspaceData(abort.signal).then(data => {
      setCatalog(data.catalog);
      setSets(data.boundary_sets);
      const preferences = readProfile();
      if (preferences) { setIncome(preferences.income); setBudget(preferences.rent); }
      const params = new URLSearchParams(window.location.search);
      const requestedId = params.get('neighbourhood') ?? (initialSidebar === 'recommended' ? recommendedPlaces[0]?.id : initialSidebar === 'saved' ? parsePlaces(readSavedRaw())[0]?.id : null);
      if (params.get('list') === 'recommended' && initialSidebar !== 'recommended') { router.replace('/housing/recommended/'); return; }
      if (params.get('list') === 'saved') setSidebar('saved');
      if (params.get('view') === 'across-time') setAcrossTime(true);
      const requestedSet = data.boundary_sets.find(s => s.neighbourhoods.some(n => n.id === requestedId));
      const current = requestedSet ?? data.boundary_sets.find(s => s.id === 'toronto-158') ?? data.boundary_sets[0];
      if (!current || !current.years.length || !current.neighbourhoods.length) {
        setLoadError('No neighbourhood data is loaded. Import the published Census data to explore housing.');
        return;
      }
      setSelection({ boundarySetId: current.id, geographyId: current.neighbourhoods.find(n => n.id === requestedId)?.id ?? defaultNeighbourhoodId(current), year: current.years.includes(Number(params.get("year"))) ? Number(params.get("year")) : current.years.at(-1)! });
    }).catch(e => { if (!abort.signal.aborted) setLoadError(e.message); });
    return () => abort.abort();
  }, [initialSidebar, recommendedPlaces, router]);

  useEffect(() => {
    if (!viewSelection || !catalog) return;
    const abort = new AbortController();
    const key = `${viewSelection.geographyId}:${viewSelection.year}`;
    loadProfile(catalog, viewSelection.geographyId, viewSelection.year, abort.signal)
      .then(data => { setResult({ key, profile: data }); setProfileError(null); })
      .catch(e => { if (!abort.signal.aborted) setProfileError({ key, message: e.message }); });
    return () => abort.abort();
  }, [viewSelection, catalog]);

  useEffect(() => {
    if (profile && !budgetAnchorHandled.current && window.location.hash === '#budget-title') {
      document.getElementById('budget-title')?.scrollIntoView({block:'center'});
      budgetAnchorHandled.current = true;
    }
  }, [profile]);

  function savePlaces(next: SavedPlace[]) {
    if (!writeSaved(next)) setStorageNotice('Saved places are available for this session only.');
  }
  function updateSelection(next: ExplorationSelection) {
    setPreview(null);
    const set = sets.find(s => s.id === next.boundarySetId);
    if (set?.years.includes(next.year) && set.neighbourhoods.some(n => n.id === next.geographyId)) setSelection(next);
  }
  /** Starts a new selection in another set at the same place on the map. Names and codes
   * are never matched across sets, because they don't imply the areas are the same. */
  async function switchBoundarySet(set: BoundarySet) {
    if (!selection) return;
    setPreview(null);
    switchAbort.current?.abort();
    const abort = switchAbort.current = new AbortController();
    let geographyId = defaultNeighbourhoodId(set);
    try {
      const [source, target] = await Promise.all([loadBoundaries(selection.boundarySetId, abort.signal), loadBoundaries(set.id, abort.signal)]);
      const match = findAtSameLocation(source, selection.geographyId, target)?.properties.geography_id;
      if (match && set.neighbourhoods.some(n => n.id === match)) geographyId = match;
    } catch { if (abort.signal.aborted) return; }
    setSelection({ boundarySetId: set.id, geographyId, year: set.years.at(-1)! });
  }
  useEffect(() => {
    setContext(profile ? { profiles: [profile], title: `${profile.geography.name} · ${profile.year} Census` } : null);
    return () => setContext(null);
  }, [profile, setContext]);
  const isSaved = !!profile && saved.some(s => s.id === profile.geography.id);
  function addSelected() {
    if (profile && !isSaved && saved.length < 5) {
      savePlaces([...saved, { id: profile.geography.id, name: profile.geography.name, year: profile.year, boundary: profile.geography.boundary_set }]);
      setSidebar("saved");
    }
  }
  function placeSelection(place: ExplorerPlace): ExplorationSelection | null {
    const set = sets.find(s => s.id === place.boundary && s.years.includes(place.year) && s.neighbourhoods.some(n => n.id === place.id));
    return set ? { boundarySetId: set.id, geographyId: place.id, year: place.year } : null;
  }
  function openComparison(places: ExplorerPlace[]) {
    router.push(comparisonHref(places, sidebar === "recommended" ? "recommended" : "saved"));
  }
  return <div className={styles.explorer}>
    <header className={styles.navigation}>
      <Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link>
      <span className={styles.navContext}>Toronto · Neighbourhoods</span>
      <nav className={styles.viewNavigation} aria-label="Exploration views"><Link href="/housing/" aria-current="page">3D Map explorer</Link><button type="button" onClick={() => openComparison(saved)}>Compare selection</button><span>BROWSE THROUGH TIME</span></nav>
      {/* eslint-disable-next-line @next/next/no-img-element -- local Figma icon */}
      <Link href="/housing/profile/" className={styles.profileLink} aria-label="Open your profile"><img src="/icons/explorer/profile.svg" width={24} height={24} alt="" /></Link>
    </header>
    <main className={`${styles.workspace} ${sidebar !== "collapsed" ? styles.workspaceExpanded : ""}`}>
      <PlacesSidebar mode={sidebar} onModeChange={mode => { if (mode === "recommended") router.push("/housing/recommended/"); else if (mode === "saved" && initialSidebar === "recommended") router.push("/housing/saved/"); else { setSidebar(mode); setPreview(null); } }} saved={saved} recommended={recommendedPlaces} selectedId={viewSelection?.geographyId}
        onSelect={place => { const next = placeSelection(place); if (next) updateSelection(next); }}
        onPreview={place => setPreview(place ? placeSelection(place) : null)} onRemove={place => savePlaces(saved.filter(p => p.id !== place.id || p.year !== place.year))}
        onCompare={openComparison} notice={sidebar === "recommended" ? recommendationNotice : storageNotice} />
      <section className={styles.mapArea} aria-label="Shared exploration map area">
        {!renderMap && <div className={styles.mapTopline}><span className={styles.kicker}>EXPLORE A NEIGHBOURHOOD</span><span className={styles.mapStatus}>Map integration pending</span></div>}
        {/* The map's search replaces this picker, but neither is available without a Mapbox token. */}
        {(!renderMap || !MAPBOX_TOKEN) && selection && activeSet && <div className={styles.locationControls}>
          <label>Neighbourhood<select aria-label="Neighbourhood" value={selection.geographyId} onChange={e => setSelection({ ...selection, geographyId: e.target.value })}>{activeSet.neighbourhoods.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        </div>}
        {renderMap ? <div className={styles.mapSlot}>{renderMap(viewSelection, updateSelection)}</div> : loadError ? <div className={styles.mapMessage} role="alert"><h1>Data is unavailable</h1><p>{loadError}</p><button className={styles.secondaryButton} onClick={() => window.location.reload()}>Try again</button></div> : !selection ? <div className={styles.mapMessage} role="status">Loading neighbourhoods…</div> : <div className={styles.mapMessage}>
          <span className={styles.mapPlaceholderMark} aria-hidden="true">⌖</span><span className={styles.kicker}>A SPACE FOR EXPLORATION</span><h2>The map belongs here.</h2><p>Explore housing in the details panel.<br />The shared map will connect here when it is ready.</p><span className={styles.placeholderTag}>Housing data connected <span aria-hidden="true">✓</span></span>
        </div>}
        {(!selection || !activeSet) && <div className={styles.mapDock}><CensusTimeline years={[]} year={null} onYearChange={() => {}} /></div>}
        {selection && activeSet && <div className={styles.mapDock}>
          <div className={styles.dockRow}>
            <div className={styles.selectedCard}><span className={styles.rustKicker}>SELECTED PLACE</span><strong>{selectedPlace?.name}</strong><p>Selected neighbourhood · choose a year below to explore its Census data.</p></div>
            <button type="button" className={styles.acrossTime} onClick={() => router.push(explorerHref(viewSelection, !acrossTime))}>{acrossTime ? "Back to single-period view" : "Compare this location across time"}</button>
          </div>
          <CensusTimeline years={activeSet.years} year={viewSelection?.year ?? selection.year} onYearChange={year => { setPreview(null); setSelection({ ...(viewSelection ?? selection), year }); }} controls={
            <select aria-label="Boundary set" value={viewSelection?.boundarySetId ?? selection.boundarySetId} onChange={e => void switchBoundarySet(sets.find(s => s.id === e.target.value)!)}>{sets.map(s => <option key={s.id} value={s.id}>{s.label} neighbourhoods · {s.years.join(', ')}</option>)}</select>} />
        </div>}
      </section>
      {profile ? acrossTime ? <AcrossTimePanel key={profile.geography.id} profile={profile} onCompare={addSelected} onAskTeacher={openTeacher} saved={isSaved} limitReached={saved.length >= 5} /> : <NeighbourhoodDetailsPanel profile={profile} income={income} budget={budget} onIncomeChange={setIncome} onBudgetChange={setBudget} saved={isSaved} limitReached={saved.length >= 5} onCompare={addSelected} onAskTeacher={openTeacher} /> : <aside className={styles.detailsPanel}><div className={styles.panelScroll} role={error ? 'alert' : 'status'}><span className={styles.kicker}>NEIGHBOURHOOD DETAILS</span><h2>{error ? 'Could not load this selection' : loadError ? 'Waiting for published data' : 'Loading housing data…'}</h2><p>{error || loadError || 'Finding the selected Census period and its sources.'}</p>{error && <button className={styles.secondaryButton} onClick={() => setSelection(s => s ? { ...s } : null)}>Try again</button>}</div></aside>}
    </main>

  </div>;
}
