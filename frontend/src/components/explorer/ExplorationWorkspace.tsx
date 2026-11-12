"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CensusTimeline } from "./CensusTimeline";
import { NeighbourhoodDetailsPanel } from "./NeighbourhoodDetailsPanel";
import type { BoundarySet, ExplorationSelection, NeighbourhoodProfile } from "./types";
import styles from "./explorer.module.css";
import { loadWorkspaceData, loadProfile, type Catalog } from "./data";

type SavedPlace = { id: string; name: string; year: number; boundary: string };
const savedKey = 'mcp-canada-saved-housing';
function subscribeSaved(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('saved-housing-change', callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener('saved-housing-change', callback); };
}
function readSaved() { try { return localStorage.getItem(savedKey) || '[]'; } catch { return '[]'; } }
/** Shared selection is owned here. A teammate can mount the map with renderMap
 * and route map clicks through onSelectionChange; the panel and timeline sync. */
export function ExplorationWorkspace({ renderMap }: {
  renderMap?: (selection: ExplorationSelection, onSelectionChange: (selection: ExplorationSelection) => void) => ReactNode;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [sets, setSets] = useState<BoundarySet[]>([]);
  const [selection, setSelection] = useState<ExplorationSelection | null>(null);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<{ key: string; profile: NeighbourhoodProfile } | null>(null);
  const [profileError, setProfileError] = useState<{ key: string; message: string } | null>(null);
  const [income, setIncome] = useState('');
  const [budget, setBudget] = useState('');
  useEffect(() => {
    const saved = localStorage.getItem("mcp-canada-budget-preferences");

    if (saved) {
      const preferences = JSON.parse(saved);

      setIncome(
        preferences.before_tax_income != null
          ? String(preferences.before_tax_income * 12)
          : ""
      );

      setBudget(
        preferences.monthly_rent != null
          ? String(preferences.monthly_rent)
          : ""
      );
    }
  }, []);
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
  const selectionKey = selection ? `${selection.geographyId}:${selection.year}` : '';
  const activeSet = sets.find(s => s.id === selection?.boundarySetId);
  const profile = result?.key === selectionKey ? result.profile : null;
  const error = profileError?.key === selectionKey ? profileError.message : '';

  useEffect(() => {
    const abort = new AbortController();
    loadWorkspaceData(abort.signal).then(data => {
      setCatalog(data.catalog);
      setSets(data.boundary_sets);
      const requestedId = new URLSearchParams(window.location.search).get('neighbourhood');
      const requestedSet = data.boundary_sets.find(s => s.neighbourhoods.some(n => n.id === requestedId));
      const current = requestedSet ?? data.boundary_sets.find(s => s.id === 'toronto-158') ?? data.boundary_sets[0];
      if (!current || !current.years.length || !current.neighbourhoods.length) {
        setLoadError('No neighbourhood data is loaded. Import the published Census data to explore housing.');
        return;
      }
      setSelection({ boundarySetId: current.id, geographyId: current.neighbourhoods.find(n => n.id === requestedId)?.id ?? current.neighbourhoods.find(n => n.code === '1')?.id ?? current.neighbourhoods[0].id, year: current.years.at(-1)! });
    }).catch(e => { if (!abort.signal.aborted) setLoadError(e.message); });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!selection || !catalog) return;
    const abort = new AbortController();
    const key = `${selection.geographyId}:${selection.year}`;
    loadProfile(catalog, selection.geographyId, selection.year, abort.signal)
      .then(data => { setResult({ key, profile: data }); setProfileError(null); })
      .catch(e => { if (!abort.signal.aborted) setProfileError({ key, message: e.message }); });
    return () => abort.abort();
  }, [selection, catalog]);

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
    const set = sets.find(s => s.id === next.boundarySetId);
    if (set?.years.includes(next.year) && set.neighbourhoods.some(n => n.id === next.geographyId)) setSelection(next);
  }
  const isSaved = !!profile && saved.some(s => s.id === profile.geography.id && s.year === profile.year);
  return <div className={styles.explorer}>
    <header className={styles.navigation}>
      <Link href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true">N</span><span>Neighbourhood<span>Explorer / Toronto</span></span></Link>
      <div className={styles.navContext}><span className={styles.navDot} /> Housing &amp; affordability</div>
      <div className={styles.navActions}><Link href="/housing/data/">Browse source data ↗</Link><button type="button" className={styles.secondaryButton} onClick={() => dialog.current?.showModal()}>Saved places <span className={styles.savedCount}>{saved.length}</span></button></div>
    </header>
    <main className={styles.workspace}>
      <section className={styles.mapArea} aria-label="Shared exploration map area">
        <div className={styles.mapTopline}><span className={styles.kicker}>EXPLORE A NEIGHBOURHOOD</span><span className={styles.mapStatus}>{renderMap ? 'Map view' : 'Map integration pending'}</span></div>
        {selection && activeSet && <div className={styles.locationControls}>
          <label>Boundary set<select aria-label="Boundary set" value={selection.boundarySetId} onChange={e => {
            const set = sets.find(s => s.id === e.target.value)!;
            // Start an explicit new selection: names/codes never imply a crosswalk.
            setSelection({ boundarySetId: set.id, geographyId: set.neighbourhoods[0].id, year: set.years.at(-1)! });
          }}>{sets.map(s => <option key={s.id} value={s.id}>{s.label} neighbourhoods</option>)}</select></label>
          <label>Neighbourhood<select aria-label="Neighbourhood" value={selection.geographyId} onChange={e => setSelection({ ...selection, geographyId: e.target.value })}>{activeSet.neighbourhoods.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        </div>}
        {loadError ? <div className={styles.mapMessage} role="alert"><h1>Data is unavailable</h1><p>{loadError}</p><button className={styles.secondaryButton} onClick={() => window.location.reload()}>Try again</button></div> : !selection ? <div className={styles.mapMessage} role="status">Loading neighbourhoods…</div> : renderMap ? <div className={styles.mapSlot}>{renderMap(selection, updateSelection)}</div> : <div className={styles.mapMessage}>
          <span className={styles.mapPlaceholderMark} aria-hidden="true">⌖</span><span className={styles.kicker}>A SPACE FOR EXPLORATION</span><h2>The map belongs here.</h2><p>Explore housing in the details panel.<br />The shared map will connect here when it is ready.</p><span className={styles.placeholderTag}>Housing data connected <span aria-hidden="true">✓</span></span>
        </div>}
        {selection && activeSet && <div className={styles.mapBottom}><p className={styles.boundaryNote}>{activeSet.label} boundaries remain fixed while you change the year. A different boundary set starts a new selection.</p><CensusTimeline years={activeSet.years} year={selection.year} onYearChange={year => setSelection({ ...selection, year })} /></div>}
      </section>
      {profile ? <NeighbourhoodDetailsPanel profile={profile} income={income} budget={budget} onIncomeChange={setIncome} onBudgetChange={setBudget} saved={isSaved} limitReached={saved.length >= 5} onCompare={() => {
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
