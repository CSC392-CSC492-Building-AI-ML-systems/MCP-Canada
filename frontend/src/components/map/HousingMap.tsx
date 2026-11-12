"use client";

import { useEffect, useMemo, useState } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import type { ExplorationSelection } from "@/components/explorer/types";
import { findBoundary, loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN, placeFromSearch, type Place } from "@/lib/mapbox";
import styles from "./HousingMap.module.css";

const OUTSIDE_NOTICE = "This location is outside the loaded neighbourhood boundaries, so the selection did not change.";

/** Map and location search for the housing explorer's map slot. Outlines the
 * active boundary set and highlights the selected neighbourhood;
 * clicking a neighbourhood, or searching an address inside one, selects it. */
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

  useEffect(() => {
    const abort = new AbortController();
    const setId = selection.boundarySetId;
    loadBoundaries(setId, abort.signal)
      .then((data) => setLoaded({ setId, data }))
      // Without outlines the map still works; the details panel shows the selection.
      .catch((e) => { if (!abort.signal.aborted) console.error(e); });
    return () => abort.abort();
  }, [selection.boundarySetId]);

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
      show3dObjects={show3d} showTransit={showTransit} className={styles.map} />
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
      </div>
      <div className={styles.search}>
        <LocationSearch onSelect={onPlace} localOptions={localOptions} onLocalSelect={(id) => { setNotice(""); onSelectionChange({ ...selection, geographyId: id }); }} />
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
    </div>
    <p className={styles.disclosure}>Basemap © Mapbox · present day, not historical</p>
  </div>;
}
