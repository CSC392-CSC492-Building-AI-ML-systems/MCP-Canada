"use client";

import { useEffect, useMemo, useState } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import type { ExplorationSelection } from "@/components/explorer/types";
import { findBoundary, loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN, placeFromSearch, type Place } from "@/lib/mapbox";
import { loadPopulation, POPULATION_SCALE, type PopulationLayer } from "@/lib/population";
import styles from "./HousingMap.module.css";

const OUTSIDE_NOTICE = "This location is outside the loaded neighbourhood boundaries, so the selection did not change.";

/** Map and location search for the housing explorer's map slot. Outlines the
 * active boundary set and highlights the selected neighbourhood;
 * clicking a neighbourhood, or searching an address inside one, selects it.
 * Neighbourhoods are shaded by population for the selected Census year. */
export default function HousingMap({ selection, onSelectionChange }: {
  selection: ExplorationSelection;
  onSelectionChange: (selection: ExplorationSelection) => void;
}) {
  // A place chosen on the landing page arrives in the URL. Its neighbourhood, if it
  // has one, is already selected by the workspace from ?neighbourhood=.
  const [selected, setSelected] = useState<{ place: Place; geographyId: string } | null>(() => {
    const place = typeof window === "undefined" ? null : placeFromSearch(window.location.search);
    return place && { place, geographyId: selection.geographyId };
  });
  const [notice, setNotice] = useState(() => selected && !new URLSearchParams(window.location.search).has("neighbourhood") ? OUTSIDE_NOTICE : "");
  // A searched place only stays marked while the neighbourhood selected with it does.
  if (selected && selected.geographyId !== selection.geographyId) {
    setSelected(null);
    setNotice("");
  }
  const [loaded, setLoaded] = useState<{ setId: string; data: Boundaries } | null>(null);
  // Ignore outlines from a previous boundary set while the new one loads.
  const boundaries = loaded?.setId === selection.boundarySetId ? loaded.data : null;
  const [show3d, setShow3d] = useState(true);
  const [showTransit, setShowTransit] = useState(true);
  const selectedName = boundaries?.features.find((f) => f.properties.geography_id === selection.geographyId)?.properties.name;
  const localOptions = useMemo(() => boundaries?.features.map((f) => ({
    id: f.properties.geography_id, name: f.properties.name, detail: `Toronto neighbourhood ${f.properties.code}`,
  })) ?? [], [boundaries]);
  const populationKey = `${selection.boundarySetId}:${selection.year}`;
  const [population, setPopulation] = useState<{ key: string; layer?: PopulationLayer; error?: string } | null>(null);
  // Only shade with numbers for the boundary set and year on screen, never stale ones.
  const current = population?.key === populationKey ? population : null;

  useEffect(() => {
    const abort = new AbortController();
    const setId = selection.boundarySetId;
    loadBoundaries(setId, abort.signal)
      .then((data) => setLoaded({ setId, data }))
      // Without outlines the map still works; the details panel shows the selection.
      .catch((e) => { if (!abort.signal.aborted) console.error(e); });
    return () => abort.abort();
  }, [selection.boundarySetId]);

  useEffect(() => {
    const abort = new AbortController();
    const key = `${selection.boundarySetId}:${selection.year}`;
    loadPopulation(selection.boundarySetId, selection.year, abort.signal)
      .then((layer) => setPopulation({ key, layer }))
      .catch((e) => { if (!abort.signal.aborted) setPopulation({ key, error: e.message }); });
    return () => abort.abort();
  }, [selection.boundarySetId, selection.year]);

  function onPlace(place: Place) {
    // Only the active boundary set is searched; a point is never mapped to another set.
    const match = boundaries && findBoundary(boundaries, place.coordinates);
    setSelected({ place, geographyId: match ? match.properties.geography_id : selection.geographyId });
    setNotice(match ? "" : OUTSIDE_NOTICE);
    if (match) onSelectionChange({ ...selection, geographyId: match.properties.geography_id });
  }

  if (!MAPBOX_TOKEN) {
    return <p className={styles.missingToken} role="alert">
      Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code> to show the map.
    </p>;
  }

  return <div className={styles.stage}>
    <MapView selected={selected?.place ?? null} boundaries={boundaries} selectedGeographyId={selection.geographyId}
      onGeographyClick={(geographyId) => onSelectionChange({ ...selection, geographyId })}
      onPlaceDismiss={() => { setSelected(null); setNotice(""); }}
      show3dObjects={show3d} showTransit={showTransit} shading={current?.layer?.values} className={styles.map} />
    <div className={styles.topRow}>
      <div className={styles.overlayColumn}>
        <div className={styles.headerCard}>
          <h2>{selectedName ?? "Toronto"}</h2>
          <p>Drag to rotate · scroll to zoom · select a neighbourhood</p>
        </div>
        <div className={styles.chips} role="group" aria-label="Map layers">
          <button type="button" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}>3D buildings</button>
          <button type="button" aria-pressed={showTransit} onClick={() => setShowTransit((v) => !v)}>Transit</button>
          {/* No verified data yet; shown so the gap is visible rather than hidden. */}
          <button type="button" aria-disabled="true" title="No land-use data is loaded yet">Land use<span className={styles.srOnly}> (no data loaded yet)</span></button>
          <button type="button" aria-disabled="true" title="No historic imagery is loaded yet">Historic imagery<span className={styles.srOnly}> (no data loaded yet)</span></button>
        </div>
        <section className={styles.legend} aria-labelledby="population-legend-title" aria-live="polite">
          <h2 id="population-legend-title">Population, {selection.year}</h2>
          {current?.layer ? <>
            <ul>
              {POPULATION_SCALE.labels.map((label, i) => <li key={label}><span style={{ background: POPULATION_SCALE.colors[i] }} />{label}</li>)}
              <li><span style={{ background: POPULATION_SCALE.noData }} />No data</li>
            </ul>
            {current.layer.note && <p className={styles.legendNote}>{current.layer.note}</p>}
            <p>Same scale for every year. Source: {current.layer.source.publisher}, {current.layer.source.title}.</p>
          </> : <p>{current?.error ? `Population unavailable: ${current.error}` : "Loading population…"}</p>}
        </section>
      </div>
      <div className={styles.search}>
        <LocationSearch onSelect={onPlace} localOptions={localOptions} onLocalSelect={(id) => { setNotice(""); onSelectionChange({ ...selection, geographyId: id }); }} />
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
    </div>
    <p className={styles.disclosure}>Basemap © Mapbox · present day, not historical</p>
  </div>;
}
