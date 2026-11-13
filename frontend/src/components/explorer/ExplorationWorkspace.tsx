"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AcrossTimePanel } from "./AcrossTimePanel";
import { PlacesSidebar, type ExplorerPlace, type SidebarMode } from "./PlacesSidebar";
import { PlaceComparison } from "./PlaceComparison";
import { CensusTimeline } from "./CensusTimeline";
import { NeighbourhoodDetailsPanel } from "./NeighbourhoodDetailsPanel";
import type { BoundarySet, ExplorationSelection, NeighbourhoodProfile } from "./types";
import styles from "./explorer.module.css";
import { loadWorkspaceData, loadProfile, type Catalog } from "./data";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import { findAtSameLocation, loadBoundaries } from "@/lib/boundaries";

const defaultNeighbourhoodId = (set: BoundarySet) => set.neighbourhoods.find(n => n.code === '1')?.id ?? set.neighbourhoods[0].id;
type SavedPlace = ExplorerPlace;
const savedKey = 'mcp-canada-saved-housing';
function subscribeSaved(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('saved-housing-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('saved-housing-change', callback); };
}
const budgetStorageKey = "mcp-canada-budget-preferences";

function subscribeBudget(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("budget-preferences-change", callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("budget-preferences-change", callback);
  };
}

function readBudgetPreferences() {
  try {
    return localStorage.getItem(budgetStorageKey) ?? "";
  } catch {
    return "";
  }
}
function readSaved() { try { return localStorage.getItem(savedKey) || '[]'; } catch { return '[]'; } }
/** Shared selection is owned here. A teammate can mount the map with renderMap
 * and route map clicks through onSelectionChange; the panel and timeline sync. */
export function ExplorationWorkspace({ renderMap, recommendedPlaces = [] }: {
  recommendedPlaces?: ExplorerPlace[];
  renderMap?: (selection: ExplorationSelection | null, onSelectionChange: (selection: ExplorationSelection) => void) => ReactNode;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sets, setSets] = useState<BoundarySet[]>([]);
  const [selection, setSelection] = useState<ExplorationSelection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [sidebar, setSidebar] = useState<SidebarMode>("collapsed");
  const [acrossTime, setAcrossTime] = useState(false);
  const [preview, setPreview] = useState<ExplorationSelection | null>(null);
  const [comparison, setComparison] = useState<ExplorerPlace[]>([]);
  const viewSelection = preview ?? selection;
  const [result, setResult] = useState<{ key: string; profile: NeighbourhoodProfile } | null>(null);
  const [profileError, setProfileError] = useState<{ key: string; message: string } | null>(null);
    const storedBudget = useSyncExternalStore(
    subscribeBudget,
    readBudgetPreferences,
    () => ""
  );

  const savedBudget = useMemo(() => {
    try {
      return storedBudget ? JSON.parse(storedBudget) : null;
    } catch {
      return null;
    }
  }, [storedBudget]);

  const [incomeOverride, setIncomeOverride] = useState<string | null>(null);
  const [budgetOverride, setBudgetOverride] = useState<string | null>(null);

  const income =
    incomeOverride ??
    (savedBudget?.before_tax_income != null
      ? String(savedBudget.before_tax_income * 12)
      : "");

  const budget =
    budgetOverride ??
    (savedBudget?.monthly_rent != null
      ? String(savedBudget.monthly_rent)
      : "");
  const storedSaved = useSyncExternalStore(subscribeSaved, readSaved, () => '[]');
  const [sessionSaved, setSessionSaved] = useState<SavedPlace[] | null>(null);
  const saved = useMemo(() => {
    if (sessionSaved) return sessionSaved;
    try {
      const data: unknown = JSON.parse(storedSaved);
      return Array.isArray(data) ? data.filter((x): x is SavedPlace => x && typeof x.id === 'string' && typeof x.name === 'string' && Number.isInteger(x.year) && typeof x.boundary === 'string').slice(0, 5) : [];
    } catch { return []; }
  }, [storedSaved, sessionSaved]);
  const [storageNotice, setStorageNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
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
      const params = new URLSearchParams(window.location.search);
      const requestedId = params.get('neighbourhood');
      if (params.get('list') === 'recommended') setSidebar('recommended');
      if (params.get('list') === 'saved') setSidebar('saved');
      if (params.get('view') === 'across-time') setAcrossTime(true);
      const requestedSet = data.boundary_sets.find(s => s.neighbourhoods.some(n => n.id === requestedId));
      const current = requestedSet ?? data.boundary_sets.find(s => s.id === 'toronto-158') ?? data.boundary_sets[0];
      if (!current || !current.years.length || !current.neighbourhoods.length) {
        setLoadError('No neighbourhood data is loaded. Import the published Census data to explore housing.');
        return;
      }
      setSelection({ boundarySetId: current.id, geographyId: current.neighbourhoods.find(n => n.id === requestedId)?.id ?? defaultNeighbourhoodId(current), year: current.years.at(-1)! });
    }).catch(e => { if (!abort.signal.aborted) setLoadError(e.message); });
    return () => abort.abort();
  }, []);

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
      document.getElementById('budget-title')?.scrollIntoView({ block: 'center' });
      budgetAnchorHandled.current = true;
    }
  }, [profile]);

  function savePlaces(next: SavedPlace[]) {
    try { localStorage.setItem(savedKey, JSON.stringify(next)); window.dispatchEvent(new Event('saved-housing-change')); }
    catch { setSessionSaved(next); setStorageNotice('Saved places are available for this session only.'); }
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
  const isSaved = !!profile && saved.some(s => s.id === profile.geography.id && s.year === profile.year);
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
    setComparison(places);
    dialog.current?.showModal();
  }
  return <div className={styles.explorer}>
    <header className={styles.navigation}>
      <Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link>
      <span className={styles.navContext}>Toronto · Neighbourhoods</span>
      <nav className={styles.viewNavigation} aria-label="Exploration views"><Link href="/housing/" aria-current="page">3D Map explorer</Link><button type="button" onClick={() => openComparison(saved)}>Compare selection</button><span>BROWSE THROUGH TIME</span></nav>
      {/* eslint-disable-next-line @next/next/no-img-element -- local Figma icon */}
      <Link href="/housing/data/" className={styles.profileLink} aria-label="Open your profile"><img src="/icons/explorer/profile.svg" width={24} height={24} alt="" /></Link>
    </header>
    <main className={`${styles.workspace} ${sidebar !== "collapsed" ? styles.workspaceExpanded : ""}`}>
      <PlacesSidebar mode={sidebar} onModeChange={mode => { setSidebar(mode); setPreview(null); }} saved={saved} recommended={recommendedPlaces} selectedId={viewSelection?.geographyId}
        onSelect={place => { const next = placeSelection(place); if (next) updateSelection(next); }}
        onPreview={place => setPreview(place ? placeSelection(place) : null)} onRemove={place => savePlaces(saved.filter(p => p.id !== place.id || p.year !== place.year))}
        onCompare={openComparison} notice={storageNotice} />
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
            <button type="button" className={styles.acrossTime} onClick={() => setAcrossTime(value => !value)}>{acrossTime ? "Back to single-period view" : "Compare this location across time"}</button>
          </div>
          <CensusTimeline years={activeSet.years} year={viewSelection?.year ?? selection.year} onYearChange={year => { setPreview(null); setSelection({ ...(viewSelection ?? selection), year }); }} controls={
            <select aria-label="Boundary set" value={viewSelection?.boundarySetId ?? selection.boundarySetId} onChange={e => void switchBoundarySet(sets.find(s => s.id === e.target.value)!)}>{sets.map(s => <option key={s.id} value={s.id}>{s.label} neighbourhoods · {s.years.join(', ')}</option>)}</select>} />
        </div>}
      </section>
      {profile ? <NeighbourhoodDetailsPanel profile={profile} income={income} budget={budget} onIncomeChange={setIncomeOverride}
onBudgetChange={setBudgetOverride} saved={isSaved} limitReached={saved.length >= 5} onCompare={() => {
        if (!isSaved && saved.length < 5) savePlaces([...saved, { id: profile.geography.id, name: profile.geography.name, year: profile.year, boundary: profile.geography.boundary_set }]);
      }} /> : <aside className={styles.detailsPanel}><div className={styles.panelScroll} role={error ? 'alert' : 'status'}><span className={styles.kicker}>NEIGHBOURHOOD DETAILS</span><h2>{error ? 'Could not load this selection' : loadError ? 'Waiting for published data' : 'Loading housing data…'}</h2><p>{error || loadError || 'Finding the selected Census period and its sources.'}</p>{error && <button className={styles.secondaryButton} onClick={() => setSelection(s => s ? { ...s } : null)}>Try again</button>}</div></aside>}
    </main>
    <dialog className={styles.savedDialog} ref={dialog} aria-labelledby="saved-title"><div className={styles.dialogHeading}><h2 id="saved-title">Saved for comparison</h2><button autoFocus type="button" aria-label="Close saved places" onClick={() => dialog.current?.close()}>×</button></div><p>Up to five places. The shared comparison view will use these selections.</p>{storageNotice && <p role="status">{storageNotice}</p>}{saved.length === 0 ? <p>No places saved yet. Choose “Add to compare” in the details panel.</p> : <ul>{saved.map(place => <li key={`${place.id}:${place.year}`}><div><strong>{place.name}</strong><span>{place.year} Census · {place.boundary}</span></div><button type="button" aria-label={`Remove ${place.name} ${place.year}`} onClick={() => savePlaces(saved.filter(s => s !== place))}>Remove</button></li>)}</ul>}<div>
      <Link href="/comparison/" className={styles.primaryButton}>
        Compare saved places →
      </Link>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={() => dialog.current?.close()}
      >
        Continue exploring
      </button>
    </div></dialog>
  </div>;
}
